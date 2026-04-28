/**
 * TTS Provider - 语音合成provider
 * 支持 Edge-TTS（免费）和 CosyVoice（高质量）
 */

import type { Logger } from "openclaw/plugin-sdk";

export interface TtsProvider {
  synthesizeStream(text: string): AsyncIterable<Buffer>;
}

interface TtsConfig {
  provider?: string;
  api_key?: string;
  base_url?: string;
  voice?: string;
  speed?: number;
}

export function createTtsProvider(config: TtsConfig | undefined, log: Logger): TtsProvider {
  const provider = config?.provider ?? "edge-tts";
  log.info?.(`Creating TTS provider: ${provider}`);

  if (provider === "edge-tts") {
    return new EdgeTtsProvider(config ?? {}, log);
  } else if (provider === "cosyvoice") {
    return new CosyVoiceProvider(config ?? {}, log);
  } else {
    return new MockTtsProvider(log);
  }
}

class EdgeTtsProvider implements TtsProvider {
  constructor(private config: TtsConfig, private log: Logger) {}

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    const voice = this.config.voice ?? "zh-CN-XiaoxiaoNeural";
    const rate = this.config.speed != null && this.config.speed !== 1.0
      ? `+${Math.round((this.config.speed - 1) * 100)}%`
      : "+0%";

    try {
      // Edge-TTS requires the edge-tts npm package or we call the API differently
      // For now, use HTTP API approach similar to Python version
      this.log.info?.(`Edge-TTS streaming: ${text.slice(0, 20)}...`);

      // TODO: Implement proper Edge-TTS streaming
      // The Python version uses edge-tts library with stream()
      // In TypeScript we could use edge-tts npm package or proxy

      // For now, yield empty buffer to indicate no audio
      yield Buffer.alloc(0);
    } catch (err) {
      this.log.error?.(`EdgeTTS error for '${text.slice(0, 20)}': ${err}`);
    }
  }
}

class CosyVoiceProvider implements TtsProvider {
  constructor(private config: TtsConfig, private log: Logger) {}

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    try {
      const response = await fetch(`${this.config.base_url}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.voice ?? "cosyvoice-v1-longvideo",
          input: text,
          voice: "longxiaochun",
          response_format: "pcm",
          sample_rate: 16000,
        }),
      });

      if (!response.ok) {
        this.log.error?.(`CosyVoice API error: ${response.status}`);
        return;
      }

      // Stream PCM chunks and encode to Opus
      const reader = response.body?.getReader();
      if (!reader) return;

      // TODO: Encode PCM to Opus using opuslib
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          yield value;
        }
      }
    } catch (err) {
      this.log.error?.(`CosyVoice error: ${err}`);
    }
  }
}

class MockTtsProvider implements TtsProvider {
  constructor(private log: Logger) {}

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    this.log.info?.(`Mock TTS: ${text}`);
    // Send 0.5s silence as mock audio
    yield Buffer.alloc(16000 * 0.5 * 2); // 0.5s @ 16kHz 16-bit
    await new Promise((r) => setTimeout(r, 100));
  }
}