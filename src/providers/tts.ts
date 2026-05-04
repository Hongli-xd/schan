/**
 * TTS Provider - 语音合成provider
 * 支持 Edge-TTS（免费）和 Qwen3-TTS（DashScope HTTP，非流式）
 */

import type { Logger } from "openclaw/plugin-sdk";
import OpusScript from "opusscript";

export interface TtsProvider {
  synthesizeStream(text: string): AsyncIterable<Buffer>;
}

interface TtsConfig {
  provider?: string;
  api_key?: string;
  base_url?: string;
  voice?: string;
  speed?: number;
  sample_rate?: number;
}

export function createTtsProvider(config: TtsConfig | undefined, log: Logger): TtsProvider {
  const provider = config?.provider ?? "edge-tts";
  log.info?.(`Creating TTS provider: ${provider}`);

  if (provider === "qwen3-tts") {
    return new Qwen3TtsProvider(config ?? {}, log);
  } else {
    return new MockTtsProvider(log);
  }
}

/**
 * Qwen3-TTS via DashScope HTTP SSE streaming.
 * SSE events carry Base64-encoded PCM16 chunks via output.audio.data.
 * Chunks are decoded and encoded to Opus on the fly.
 */
class Qwen3TtsProvider implements TtsProvider {
  private sampleRate: number;
  private baseUrl: string;
  private apiKey: string;

  constructor(private config: TtsConfig, private log: Logger) {
    this.sampleRate = this.config.sample_rate ?? 16000;
    this.baseUrl = this.config.base_url ?? "https://dashscope.aliyuncs.com/api/v1";
    this.apiKey = this.config.api_key ?? "";
  }

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    if (!this.apiKey) {
      this.log.error?.("Qwen3-TTS api_key not configured");
      return;
    }

    const validRates = [8000, 12000, 16000, 24000, 48000] as const;
    const sr = validRates.includes(this.sampleRate as typeof validRates[number]) ? this.sampleRate : 16000;
    let opusEncoder: OpusScript;
    try {
      opusEncoder = new OpusScript(sr as typeof validRates[number], 1, OpusScript.Application.AUDIO);
    } catch (e) {
      this.log.error?.(`Failed to create Opus encoder: ${e}`);
      return;
    }

    try {
      const resp = await fetch(`${this.baseUrl}/services/aigc/multimodal-generation/generation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-SSE": "enable",
        },
        body: JSON.stringify({
          model: "qwen3-tts-flash",
          input: {
            text,
            voice: this.config.voice ?? "Cherry",
            language_type: "Chinese",
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        this.log.error?.(`Qwen3-TTS API error ${resp.status}: ${errText}`);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        this.log.error?.("Qwen3-TTS: no response body");
        return;
      }

      const decoder = new TextDecoder();
      let remainder = "";
      let prevPcmLen = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (remainder + chunk).split("\n");
        remainder = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr) as {
              output?: { audio?: { data?: string } };
            };
            const b64 = event?.output?.audio?.data;
            if (!b64) continue;

            const pcmBuffer = Buffer.from(b64, "base64");
            if (pcmBuffer.length === 0) continue;

            // Deduplication: only encode the NEW portion (incremental audio)
            if (pcmBuffer.length <= prevPcmLen) continue;
            const newPcm = pcmBuffer.subarray(prevPcmLen);
            prevPcmLen = pcmBuffer.length;

            if (newPcm.length === 0) continue;
            try {
              const frameSize = Math.floor(this.sampleRate * 0.06); // 960 samples for 60ms at 16kHz
              let offset = 0;
              while (offset + frameSize * 2 <= newPcm.length) {
                const frame = newPcm.subarray(offset, offset + frameSize * 2);
                const opus = opusEncoder.encode(frame, frameSize);
                yield Buffer.from(opus);
                offset += frameSize * 2;
              }
            } catch (e) {
              this.log.debug?.(`Opus encode error: ${e}`);
            }
          } catch { /* skip malformed SSE data */ }
        }
      }
    } catch (err) {
      this.log.error?.(`Qwen3-TTS error: ${err}`);
    }
  }
}

class MockTtsProvider implements TtsProvider {
  private opusEncoder: OpusScript;
  private sampleRate = 16000;

  constructor(private log: Logger) {
    this.opusEncoder = new OpusScript(16000 as 8000 | 12000 | 16000 | 24000 | 48000, 1, OpusScript.Application.AUDIO);
  }

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    this.log.info?.(`Mock TTS: ${text}`);
    const frameSize = Math.floor(this.sampleRate * 0.06);
    const silence = Buffer.alloc(frameSize * 2);
    const opus = this.opusEncoder.encode(silence, frameSize);
    yield Buffer.from(opus);
  }
}