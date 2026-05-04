/**
 * Xiaozhi Protocol Test Simulator
 *
 * Simulates a third-party ESP32 device connecting to the xiaozhi channel.
 *
 * Usage: node --loader tsx src/sim/test-simulator.ts [host] [port]
 * Or after tsconfig.test.json compilation: npx tsc -p tsconfig.test.json && node dist-test/test-simulator.js
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";
const HOST = process.argv[2] ?? "localhost";
const PORT = parseInt(process.argv[3] ?? "8766", 10);
const WAV_FILE = "/root/.openclaw/schan/OSR_cn_000_0072_8k.wav";
class XiaozhiSimulator {
    host;
    port;
    ws = null;
    sessionId = "";
    constructor(host, port) {
        this.host = host;
        this.port = port;
    }
    async connect() {
        return new Promise((resolve, reject) => {
            // Use ws WebSocket library to connect properly
            // We need to set custom headers that xiaozhi-esp32 sends
            const url = `ws://${this.host}:${this.port}`;
            console.log(`Connecting to ${url}...`);
            this.ws = new WebSocket(url, undefined, {
                headers: {
                    "device-id": "AA:BB:CC:DD:EE:FF",
                    "client-id": "test-simulator-001",
                    "protocol-version": "1",
                    "authorization": "Bearer test-token",
                }
            });
            this.ws.on("open", () => {
                console.log("[WS] Connected");
                this.sendDeviceHello();
                resolve();
            });
            this.ws.on("message", (data) => {
                const raw = data instanceof Buffer ? data.toString("utf8") : String(data);
                console.log("[←] Received:", raw.slice(0, 300));
                try {
                    const msg = JSON.parse(raw);
                    this.processMessage(msg);
                }
                catch {
                    console.log(`[←] Binary/partial: ${raw.length} chars`);
                }
            });
            this.ws.on("close", (code, reason) => {
                console.log(`[WS] Closed: code=${code} reason=${reason}`);
            });
            this.ws.on("error", (err) => {
                console.error("[WS] Error:", err.message);
                reject(err);
            });
        });
    }
    sendDeviceHello() {
        const hello = {
            type: "hello",
            version: 1,
            transport: "websocket",
            audio_params: {
                format: "opus",
                sample_rate: 16000,
                channels: 1,
                frame_duration: 60,
            },
        };
        this.ws?.send(JSON.stringify(hello));
        console.log("[→] Sent Device Hello:", JSON.stringify(hello));
    }
    processMessage(msg) {
        switch (msg.type) {
            case "hello": {
                const sh = msg;
                this.sessionId = sh.session_id ?? "";
                console.log(`[✓] Handshake complete, session_id=${this.sessionId}`);
                // Wait a bit then start listening
                setTimeout(() => this.startListening(), 200);
                break;
            }
            case "stt": {
                const stt = msg;
                console.log(`[🎤] STT: "${stt.text ?? ""}"`);
                setTimeout(() => {
                    console.log("[=] Test session complete.");
                    this.ws?.close();
                }, 3000);
                break;
            }
            case "tts": {
                const tts = msg;
                console.log(`[🔊] TTS: state=${tts.state}${tts.text ? ` text="${tts.text}"` : ""}`);
                break;
            }
            case "llm": {
                const llm = msg;
                console.log(`[💬] LLM emotion: ${llm.emotion ?? "none"}`);
                break;
            }
            default:
                console.log(`[?]`);
        }
    }
    startListening() {
        // Send listen start
        this.ws?.send(JSON.stringify({ type: "listen", state: "detect", text: "xiaozhi" }));
        console.log("[→] Sent listen: state=detect");
        // Send audio in chunks
        const audioData = readFileSync(WAV_FILE);
        const chunkSize = 1024;
        let offset = 0;
        const sendChunk = () => {
            const chunk = audioData.subarray(offset, offset + chunkSize);
            if (chunk.length === 0) {
                // All sent - send stop
                setTimeout(() => {
                    this.ws?.send(JSON.stringify({ type: "listen", state: "stop" }));
                    console.log("[→] Sent listen: state=stop (audio sent)");
                }, 100);
                return;
            }
            this.ws?.send(chunk, (err) => {
                if (err) {
                    console.error("[→] Send error:", err);
                    return;
                }
                offset += chunk.length;
                // Send next chunk after small delay (simulate real-time)
                setTimeout(sendChunk, 20);
            });
        };
        setTimeout(sendChunk, 100);
    }
    async close() {
        return new Promise((resolve) => {
            this.ws?.on("close", () => resolve());
            this.ws?.close();
            setTimeout(resolve, 2000);
        });
    }
}
async function main() {
    console.log("=== Xiaozhi Protocol Test Simulator ===");
    console.log(`Target: ws://${HOST}:${PORT}`);
    console.log(`Audio:  ${WAV_FILE}`);
    console.log("");
    const sim = new XiaozhiSimulator(HOST, PORT);
    try {
        await sim.connect();
        await new Promise((r) => setTimeout(r, 15000));
    }
    catch (err) {
        console.error("Connection failed:", err);
        console.error("Note: Start the xiaozhi channel server first (openclaw run or gateway)");
    }
    finally {
        await sim.close();
    }
    console.log("\n=== Done ===");
}
main().catch(console.error);
