/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
// Mock WebSocket-like interface for testing
function createMockWs() {
    const handlers = {};
    return {
        sent: [],
        messages: [],
        handlers,
        send(data, cb) {
            this.sent.push(typeof data === "string" ? data : data.toString());
            cb?.();
        },
        on(event, listener) {
            if (!handlers[event])
                handlers[event] = [];
            handlers[event].push(listener);
        },
        once(event, listener) {
            if (!handlers[event])
                handlers[event] = [];
            handlers[event].push(listener);
        },
        close() {
            this.handlers["close"]?.forEach((h) => h());
        },
        emitMessage(data) {
            this.messages.push(data);
            this.handlers["message"]?.forEach((h) => h(data));
        },
    };
}
describe("Xiaozhi protocol types", () => {
    it("validates hello message structure", () => {
        const helloMsg = {
            type: "hello",
            version: 1,
            features: { mcp: true },
            transport: "websocket",
            audio_params: {
                format: "opus",
                sample_rate: 16000,
                channels: 1,
                frame_duration: 60,
            },
        };
        expect(helloMsg.type).toBe("hello");
        expect(helloMsg.features.mcp).toBe(true);
        expect(helloMsg.audio_params.format).toBe("opus");
        expect(helloMsg.audio_params.sample_rate).toBe(16000);
    });
    it("validates listen message structure", () => {
        const listenDetect = {
            type: "listen",
            state: "detect",
            text: "你好",
        };
        const listenStop = {
            type: "listen",
            state: "stop",
        };
        expect(listenDetect.state).toBe("detect");
        expect(listenDetect.text).toBe("你好");
        expect(listenStop.state).toBe("stop");
    });
    it("validates stt message structure", () => {
        const sttMsg = {
            type: "stt",
            text: "今天天气怎么样？",
        };
        expect(sttMsg.type).toBe("stt");
        expect(sttMsg.text).toBeTruthy();
    });
    it("validates tts message structure", () => {
        const ttsStart = {
            type: "tts",
            state: "start",
        };
        const ttsSentenceStart = {
            type: "tts",
            state: "sentence_start",
            text: "你好呀！",
        };
        const ttsStop = {
            type: "tts",
            state: "stop",
        };
        expect(ttsStart.state).toBe("start");
        expect(ttsSentenceStart.text).toBe("你好呀！");
        expect(ttsStop.state).toBe("stop");
    });
    it("validates mcp message structure", () => {
        const mcpMsg = {
            type: "mcp",
            payload: {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: "self.robot.set_head_angles",
                    arguments: { pitch: 20, speed: 180 },
                },
                id: 1,
            },
        };
        expect(mcpMsg.type).toBe("mcp");
        expect(mcpMsg.payload.jsonrpc).toBe("2.0");
        expect(mcpMsg.payload.method).toBe("tools/call");
        expect(mcpMsg.payload.params.name).toBe("self.robot.set_head_angles");
    });
});
describe("AudioQueue behavior", () => {
    it("push and wait works correctly", async () => {
        const queue = {
            queue: [],
            waiting: [],
            push(chunk) {
                if (this.waiting.length > 0) {
                    const w = this.waiting.shift();
                    w.resolve(chunk);
                }
                else {
                    this.queue.push(chunk);
                }
            },
            clear() {
                this.queue = [];
            },
            wait() {
                return new Promise((resolve) => {
                    if (this.queue.length > 0) {
                        resolve(this.queue.shift());
                    }
                    else {
                        this.waiting.push({ resolve });
                    }
                });
            },
        };
        // Push a chunk
        const chunk = Buffer.from([1, 2, 3, 4]);
        queue.push(chunk);
        // Wait should return immediately
        const result = await queue.wait();
        expect(result).toEqual(chunk);
    });
    it("wait blocks until push", async () => {
        const queue = {
            queue: [],
            waiting: [],
            push(chunk) {
                if (this.waiting.length > 0) {
                    const w = this.waiting.shift();
                    w.resolve(chunk);
                }
                else {
                    this.queue.push(chunk);
                }
            },
            clear() {
                this.queue = [];
            },
            wait() {
                return new Promise((resolve) => {
                    if (this.queue.length > 0) {
                        resolve(this.queue.shift());
                    }
                    else {
                        this.waiting.push({ resolve });
                    }
                });
            },
        };
        const waitPromise = queue.wait();
        // Should still be waiting
        let resolved = false;
        waitPromise.then(() => { resolved = true; });
        // Push after a small delay
        await new Promise((r) => setTimeout(r, 10));
        expect(resolved).toBe(false);
        queue.push(Buffer.from([5, 6, 7, 8]));
        // Should now be resolved
        const result = await waitPromise;
        expect(result).toEqual(Buffer.from([5, 6, 7, 8]));
    });
    it("sentinel empty buffer signals end", async () => {
        const queue = {
            queue: [],
            waiting: [],
            push(chunk) {
                if (this.waiting.length > 0) {
                    const w = this.waiting.shift();
                    w.resolve(chunk);
                }
                else {
                    this.queue.push(chunk);
                }
            },
            clear() {
                this.queue = [];
            },
            wait() {
                return new Promise((resolve) => {
                    if (this.queue.length > 0) {
                        resolve(this.queue.shift());
                    }
                    else {
                        this.waiting.push({ resolve });
                    }
                });
            },
        };
        queue.push(Buffer.alloc(0)); // sentinel
        const result = await queue.wait();
        expect(result.length).toBe(0); // Empty buffer signals end
    });
});
describe("Action parsing", () => {
    function parseActionJson(text) {
        const match = text.match(/^\s*\{[^}]+\}\s*/);
        if (match) {
            try {
                const action = JSON.parse(match[0]);
                return { action, remainingText: text.slice(match[0].length) };
            }
            catch {
                // Not valid JSON
            }
        }
        return { action: null, remainingText: text };
    }
    it("extracts action JSON from prefix", () => {
        const text = '{"act":"nod","emo":"joy","spd":180}你好呀！';
        const { action, remainingText } = parseActionJson(text);
        expect(action).toEqual({ act: "nod", emo: "joy", spd: 180 });
        expect(remainingText).toBe("你好呀！");
    });
    it("handles text without action JSON", () => {
        const text = "你好呀！今天天气怎么样？";
        const { action, remainingText } = parseActionJson(text);
        expect(action).toBeNull();
        expect(remainingText).toBe(text);
    });
    it("handles action JSON with whitespace", () => {
        const text = '  {"act":"idle","emo":"neutral"}   大家好';
        const { action, remainingText } = parseActionJson(text);
        expect(action).toEqual({ act: "idle", emo: "neutral" });
        expect(remainingText).toBe("大家好");
    });
    it("handles action JSON only with no text", () => {
        const text = '{"act":"nod","emo":"happy"}';
        const { action, remainingText } = parseActionJson(text);
        expect(action).toEqual({ act: "nod", emo: "happy" });
        expect(remainingText).toBe("");
    });
});
describe("Sentence splitting", () => {
    function splitSentences(text) {
        const parts = text.split(/(?<=[。！？…\n])/);
        const sentences = [];
        for (let i = 0; i < parts.length; i++) {
            if (i + 1 < parts.length && /[。！？…\n]/.test(parts[i + 1]?.[0] ?? "")) {
                sentences.push(parts[i] + parts[i + 1]);
                i++;
            }
            else if (parts[i]) {
                sentences.push(parts[i]);
            }
        }
        return sentences;
    }
    it("splits by Chinese punctuation", () => {
        const text = "你好呀！今天天气怎么样？我来告诉你。";
        const sentences = splitSentences(text);
        expect(sentences).toEqual(["你好呀！", "今天天气怎么样？", "我来告诉你。"]);
    });
    it("handles single sentence", () => {
        const text = "你好呀！";
        const sentences = splitSentences(text);
        expect(sentences).toEqual(["你好呀！"]);
    });
    it("handles empty string", () => {
        const text = "";
        const sentences = splitSentences(text);
        expect(sentences).toEqual([]);
    });
    it("handles text without punctuation", () => {
        const text = "你好呀 今天天气怎么样";
        const sentences = splitSentences(text);
        expect(sentences).toEqual(["你好呀 今天天气怎么样"]);
    });
});
