/**
 * ASR Provider - 语音识别provider
 * 支持 SenseVoice 和 Whisper
 */

import type { Logger } from "openclaw/plugin-sdk";
import type { AsrProvider } from "../session.js";

interface AsrConfig {
  provider?: string;
  api_key?: string;
  base_url?: string;
  language?: string;
}

export function createAsrProvider(config: AsrConfig | undefined, log: Logger): AsrProvider {
  const provider = config?.provider ?? "sensevoice";
  log.info?.(`Creating ASR provider: ${provider}`);

  if (provider === "sensevoice") {
    return new SenseVoiceAsrProvider(config ?? {}, log);
  } else if (provider === "whisper") {
    return new WhisperAsrProvider(config ?? {}, log);
  } else {
    return new MockAsrProvider(log);
  }
}

class SenseVoiceAsrProvider implements AsrProvider {
  constructor(private config: AsrConfig, private log: Logger) {}

  async transcribe(audio: AsyncIterable<Buffer>): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }

    if (chunks.length === 0) return "";

    const audioData = Buffer.concat(chunks);

    try {
      // SenseVoice API expects base64 encoded audio
      const response = await fetch(`${this.config.base_url}/audio/asr`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sensevoice-v1",
          input: {
            audio_data: audioData.toString("base64"),
            format: "wav",
          },
          parameters: { language_hints: [this.config.language ?? "zh"] },
        }),
      });

      const data = await response.json() as { output?: { text?: string } };
      const text = data?.output?.text ?? "";
      this.log.info?.(`ASR result: ${text}`);
      return text;
    } catch (err) {
      this.log.error?.(`SenseVoice API error: ${err}`);
      return "";
    }
  }
}

class WhisperAsrProvider implements AsrProvider {
  constructor(private config: AsrConfig, private log: Logger) {}

  async transcribe(audio: AsyncIterable<Buffer>): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }

    if (chunks.length === 0) return "";

    const audioData = Buffer.concat(chunks);

    try {
      const formData = new FormData();
      formData.append("file", new Blob([audioData]), "audio.opus");
      formData.append("model", "whisper-1");
      formData.append("language", this.config.language ?? "zh");

      const response = await fetch(`${this.config.base_url}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.api_key}`,
        },
        body: formData,
      });

      const data = await response.json() as { text?: string };
      return data.text ?? "";
    } catch (err) {
      this.log.error?.(`Whisper error: ${err}`);
      return "";
    }
  }
}

class MockAsrProvider implements AsrProvider {
  constructor(private log: Logger) {}

  async transcribe(audio: AsyncIterable<Buffer>): Promise<string> {
    for await (const _ of audio) {
      // Discard
    }
    const text = "你好，今天天气怎么样？";
    this.log.info?.(`Mock ASR result: ${text}`);
    return text;
  }
}