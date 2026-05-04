/**
 * DashScope TTS Provider - CosyVoice-v3.5-flash via dashscope Python SDK
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
export function createTtsProvider(config, log) {
    const provider = config?.provider ?? "cosyvoice";
    log.info?.(`Creating TTS provider: ${provider}`);
    if (provider === "cosyvoice") {
        return new CosyVoiceProvider(config ?? {}, log);
    }
    if (provider === "dashscope-tts") {
        return new DashscopeTtsProvider(config ?? {}, log);
    }
    return new MockTtsProvider(log);
}
/**
 * CosyVoice provider using Python dashscope SDK.
 * Uses streaming and writes PCM chunks to temp files, then yields them.
 */
class CosyVoiceProvider {
    config;
    log;
    constructor(config, log) {
        this.config = config;
        this.log = log;
    }
    async *synthesizeStream(text) {
        const apiKey = this.config.api_key ?? process.env.DASHSCOPE_API_KEY ?? "";
        const model = this.config.model ?? "cosyvoice-v3.5-flash";
        const voiceId = this.config.voice ?? "alex";
        const tmpDir = "/tmp/xiaozhi_tts";
        try {
            mkdirSync(tmpDir, { recursive: true });
        }
        catch { /* ignore */ }
        const sessionId = Date.now().toString(36);
        const outPrefix = `${tmpDir}/tts_${sessionId}`;
        const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, " ");
        const code = `
import sys
import os
import time
import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer

dashscope.api_key = "${apiKey}"
dashscope.base_websocket_api_url = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

model = "${model}"
voice_id = "${voiceId}"

text = "${escapedText}"

synthesizer = SpeechSynthesizer(model=model, voice=voice_id)

try:
    audio_iter = synthesizer.stream(text)
    chunk_count = 0
    for chunk in audio_iter:
        if chunk:
            chunk_count += 1
            with open(f"${outPrefix}_{chunk_count:04d}.pcm", "wb") as f:
                f.write(chunk)
    
    with open(f"${outPrefix}_done", "w") as f:
        f.write(str(chunk_count))
    
    print(f"Chunks: {chunk_count}", file=sys.stderr)
except Exception as e:
    with open(f"${outPrefix}_error", "w") as f:
        f.write(str(e))
    print(f"TTS error: {e}", file=sys.stderr)
`;
        const py = spawn("python3", ["-c", code], { timeout: 60000 });
        let stderr = "";
        py.stderr.on("data", (d) => { stderr += d.toString(); });
        const exitCode = await new Promise((resolve) => {
            py.on("close", (code) => resolve(code ?? 1));
            setTimeout(() => {
                py.kill();
                resolve(-1);
            }, 60000);
        });
        this.log.info?.(`TTS exited ${exitCode}: ${stderr}`);
        if (exitCode === 0 && existsSync(`${outPrefix}_done`)) {
            const doneData = readFileSync(`${outPrefix}_done`, "utf8").trim();
            const chunkCount = parseInt(doneData, 10);
            for (let i = 1; i <= chunkCount; i++) {
                const chunkFile = `${outPrefix}_${i.toString().padStart(4, "0")}.pcm`;
                if (existsSync(chunkFile)) {
                    const chunkData = readFileSync(chunkFile);
                    yield Buffer.from(chunkData);
                    try {
                        unlinkSync(chunkFile);
                    }
                    catch { /* ignore */ }
                }
            }
            try {
                unlinkSync(`${outPrefix}_done`);
            }
            catch { /* ignore */ }
        }
        else {
            this.log.error?.(`TTS failed: ${stderr}`);
        }
    }
}
/**
 * HTTP-based TTS (non-streaming, single shot).
 * Good for short responses.
 */
class DashscopeTtsProvider {
    config;
    log;
    constructor(config, log) {
        this.config = config;
        this.log = log;
    }
    async *synthesizeStream(text) {
        const apiKey = this.config.api_key ?? process.env.DASHSCOPE_API_KEY ?? "";
        const model = this.config.model ?? "cosyvoice-v3.5-flash";
        const voice = this.config.voice ?? "alex";
        try {
            const response = await fetch("https://dashscope.aliyuncs.com/api/v1/audio/speech", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    input: { text },
                    voice,
                    response_format: "pcm",
                    sample_rate: 16000,
                    speed: this.config.speed ?? 1.0,
                }),
            });
            if (!response.ok) {
                this.log.error?.(`HTTP TTS error: ${response.status}`);
                return;
            }
            const reader = response.body?.getReader();
            if (!reader)
                return;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value) {
                    yield Buffer.from(value);
                }
            }
        }
        catch (err) {
            this.log.error?.(`HTTP TTS error: ${err}`);
        }
    }
}
class MockTtsProvider {
    log;
    constructor(log) {
        this.log = log;
    }
    async *synthesizeStream(text) {
        this.log.info?.(`Mock TTS: ${text}`);
        yield Buffer.alloc(16000 * 0.5 * 2);
        await new Promise((r) => setTimeout(r, 100));
    }
}
