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
        try {
            writeFileSync(tmpWav, audioData);
            this.log.info?.(`ASR: wrote ${audioData.length} bytes to ${tmpWav}`);
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
        }
    }
    callFunAsr(wavPath) {
        return new Promise((resolve, reject) => {
            const apiKey = this.config.api_key ?? process.env.DASHSCOPE_API_KEY ?? "";
            const model = this.config.model ?? "fun-asr-realtime-2026-02-28";
            const langHints = (this.config.language_hints ?? ["zh", "en"]).join(",");
            const escapedPath = wavPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const code = `
import sys
import os
import json
from dashscope import dashscope
from dashscope.audio.asr import Recognition
from http import HTTPStatus

dashscope.api_key = "${apiKey}"

recognition = Recognition(
    model="${model}",
    format="wav",
    sample_rate=16000,
    language_hints="${langHints}".split(","),
    callback=None
)
result = recognition.call("${escapedPath}")
if result.status_code == HTTPStatus.OK:
    sentences = result.get_sentence()
    if sentences:
        txt = getattr(sentences[0], 'text', None)
        if txt is None:
            txt = str(sentences[0])
        print(txt)
    else:
        print("")
else:
    print(f"ERROR:{result.message}", file=sys.stderr)
`;
            const py = spawn("python3", ["-c", code], { timeout: 30000 });
            let stdout = "";
            let stderr = "";
            py.stdout.on("data", (d) => { stdout += d.toString(); });
            py.stderr.on("data", (d) => { stderr += d.toString(); });
            py.on("close", (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    this.log.error?.(`FunAsr exit code ${code}: ${stderr}`);
                    reject(new Error(stderr || `exit code ${code}`));
                }
            });
            py.on("error", (err) => {
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
