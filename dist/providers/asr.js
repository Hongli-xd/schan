/**
 * DashScope ASR Provider - funasr-realtime via dashscope Python SDK
 *
 * Uses dashscope Python bindings via child_process to call the funasr API.
 * The wav file must be written to disk as Recognition.call() works with file paths.
 */
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
export function createAsrProvider(config, log) {
    const provider = config?.provider ?? "funasr";
    log.info?.(`Creating ASR provider: ${provider}`);
    if (provider === "funasr") {
        return new FunAsrProvider(config ?? {}, log);
    }
    return new MockAsrProvider(log);
}
class FunAsrProvider {
    config;
    log;
    constructor(config, log) {
        this.config = config;
        this.log = log;
    }
    async transcribe(audio) {
        const chunks = [];
        for await (const chunk of audio) {
            chunks.push(chunk);
        }
        if (chunks.length === 0)
            return "";
        const audioData = Buffer.concat(chunks);
        const tmpWav = `/tmp/xiaozhi_asr_${Date.now()}.wav`;
        const tmpWav16k = `/tmp/xiaozhi_asr_16k_${Date.now()}.wav`;
        try {
            // The received audio is RAW PCM (Opus decoded), NOT a WAV file.
            // We need to wrap it in a proper WAV header ourselves.
            // Assume 16kHz, 16-bit, mono based on xiaozhi protocol spec.
            const sampleRate = 16000;
            const bitsPerSample = 16;
            const numChannels = 1;
            const dataSize = audioData.length;
            const byteRate = sampleRate * numChannels * bitsPerSample / 8;
            const blockAlign = numChannels * bitsPerSample / 8;
            const chunkSize = 36 + dataSize;
            const wavHeader = Buffer.alloc(44);
            // "RIFF"
            wavHeader.write('RIFF', 0);
            wavHeader.writeUInt32LE(chunkSize, 4);
            // "WAVE"
            wavHeader.write('WAVE', 8);
            // "fmt "
            wavHeader.write('fmt ', 12);
            // Subchunk1Size (16 for PCM)
            wavHeader.writeUInt32LE(16, 16);
            // AudioFormat (1 for PCM)
            wavHeader.writeUInt16LE(1, 20);
            // NumChannels
            wavHeader.writeUInt16LE(numChannels, 22);
            // SampleRate
            wavHeader.writeUInt32LE(sampleRate, 24);
            // ByteRate
            wavHeader.writeUInt32LE(byteRate, 28);
            // BlockAlign
            wavHeader.writeUInt16LE(blockAlign, 32);
            // BitsPerSample
            wavHeader.writeUInt16LE(bitsPerSample, 34);
            // "data"
            wavHeader.write('data', 36);
            // Subchunk2Size
            wavHeader.writeUInt32LE(dataSize, 40);
            const wavBuffer = Buffer.concat([wavHeader, audioData]);
            writeFileSync(tmpWav, wavBuffer);
            this.log.info?.(`ASR: wrote ${wavBuffer.length} bytes (WAV with ${sampleRate}Hz header) to ${tmpWav}`);
            // Since we already wrapped with 16kHz header, process directly
            const result = await this.callFunAsr(tmpWav);
            this.log.info?.(`ASR result: ${result}`);
            return result;
        }
        catch (err) {
            this.log.error?.(`FunAsr error: ${err}`);
            return "";
        }
        finally {
            if (existsSync(tmpWav)) {
                try {
                    unlinkSync(tmpWav);
                }
                catch { /* ignore */ }
            }
            if (existsSync(tmpWav16k)) {
                try {
                    unlinkSync(tmpWav16k);
                }
                catch { /* ignore */ }
            }
        }
    }
    detectWavSampleRate(buffer) {
        // WAV header: offset 24-27 = sample rate (uint32 little-endian)
        if (buffer.length >= 28) {
            return buffer.readUInt32LE(24);
        }
        return 16000; // default
    }
    resampleWav(inputPath, outputPath, fromRate, toRate) {
        const { execSync } = require("child_process");
        try {
            execSync(`ffmpeg -y -ar ${fromRate} -i "${inputPath}" -ar ${toRate} "${outputPath}" 2>/dev/null`, { timeout: 10000 });
        }
        catch {
            // fallback: write scipy script to temp file to avoid shell escaping issues
            const scriptPath = `/tmp/xiaozhi_resample_${Date.now()}.py`;
            const script = `import scipy.io.wavfile as wav
import numpy as np
sr, data = wav.read(${JSON.stringify(inputPath)})
if len(data.shape) > 1: data = data[:, 0]
resampled = np.interp(
    np.linspace(0, len(data), int(len(data) * ${toRate} / ${fromRate})),
    np.arange(len(data)), data
).astype(data.dtype)
wav.write(${JSON.stringify(outputPath)}, ${toRate}, resampled)
`;
            writeFileSync(scriptPath, script);
            try {
                execSync(`python3 "${scriptPath}"`, { timeout: 10000 });
            }
            finally {
                try {
                    unlinkSync(scriptPath);
                }
                catch { /* ignore */ }
            }
        }
    }
    callFunAsr(wavPath) {
        return new Promise((resolve, reject) => {
            const apiKey = this.config.api_key ?? process.env.DASHSCOPE_API_KEY ?? "";
            const model = this.config.model ?? "fun-asr-realtime-2026-02-28";
            const langHints = (this.config.language_hints ?? ["zh", "en"]).join(",");
            // Write Python script to file to avoid shell escaping issues
            const scriptPath = `/tmp/xiaozhi_asr_${Date.now()}.py`;
            const script = `import sys
import os
import json
import dashscope
from dashscope.audio.asr import Recognition
from http import HTTPStatus

dashscope.api_key = ${JSON.stringify(apiKey)}

recognition = Recognition(
    model=${JSON.stringify(model)},
    format="wav",
    sample_rate=16000,
    language_hints=${JSON.stringify(langHints.split(","))},
    callback=None
)
result = recognition.call(${JSON.stringify(wavPath)}, workspace=None)
if result.status_code == HTTPStatus.OK:
    sentences = result.get_sentence()
    if sentences and len(sentences) > 0:
        sentence = sentences[0]
        if isinstance(sentence, dict):
            txt = sentence.get('text', '')
        else:
            txt = getattr(sentence, 'text', str(sentence))
        print(txt)
    else:
        print("")
else:
    print(f"ERROR:{result.message}", file=sys.stderr)
`;
            writeFileSync(scriptPath, script);
            const py = spawn("python3", [scriptPath], { timeout: 30000 });
            let stdout = "";
            let stderr = "";
            py.stdout.on("data", (d) => { stdout += d.toString(); });
            py.stderr.on("data", (d) => { stderr += d.toString(); });
            py.on("close", (code) => {
                try {
                    unlinkSync(scriptPath);
                }
                catch { /* ignore */ }
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    this.log.error?.(`FunAsr exit code ${code}: ${stderr}`);
                    reject(new Error(stderr || `exit code ${code}`));
                }
            });
            py.on("error", (err) => {
                try {
                    unlinkSync(scriptPath);
                }
                catch { /* ignore */ }
                reject(err);
            });
            setTimeout(() => {
                py.kill();
                reject(new Error("ASR timeout after 30s"));
            }, 30000);
        });
    }
}
class MockAsrProvider {
    log;
    constructor(log) {
        this.log = log;
    }
    async transcribe(audio) {
        for await (const _ of audio) { /* discard */ }
        const text = "你好，今天天气怎么样？";
        this.log.info?.(`Mock ASR result: ${text}`);
        return text;
    }
}
