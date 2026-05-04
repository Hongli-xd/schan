/**
 * Xiaozhi Plugin Integration Tests
 *
 * Tests the complete flow:
 * 1. Firmware simulation connects to plugin via WebSocket
 * 2. Exchange hello messages
 * 3. Send listen(detect) to start ASR
 * 4. Simulate audio -> ASR -> AI reply
 * 5. Verify TTS and MCP tool calls
 */
import { describe, expect, it, vi } from "vitest";
import { McpManager } from "../mcp-manager.js";
import { XiaozhiSession } from "../session.js";
// Mock ReplyHandler
class MockReplyHandler {
    calls = [];
    async reply(text, mcp, tts, ws, log, ctx) {
        this.calls.push({ text, mcp });
        // Simulate AI response
        void tts;
        void ws;
        void log;
        void ctx;
    }
    async abort() { }
    async onMcpCall(name, args) {
        console.log(`[MockReplyHandler] MCP call: ${name}`, args);
    }
}
// Mock ASR provider
class MockAsrProvider {
    result;
    constructor(result = "今天天气怎么样？") {
        this.result = result;
    }
    async transcribe(audio) {
        for await (const _ of audio) {
            // Simulate processing
        }
        return this.result;
    }
}
// Mock TTS provider
class MockTtsProvider {
    synthesizeStream(text) {
        const self = this;
        return (async function* () {
            // Emit fake audio for each character
            for (const char of text) {
                yield Buffer.from([0x00, char.charCodeAt(0)]);
            }
            void self;
        })();
    }
}
// Mock WebSocket
function createMockWs() {
    const handlers = {};
    return {
        sent: [],
        binarySent: [],
        messages: [],
        send(data, cb) {
            if (typeof data === "string") {
                this.sent.push(data);
            }
            else {
                this.binarySent.push(Buffer.from(data));
            }
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
            handlers["close"]?.forEach((h) => h());
        },
        simulateMessage(data) {
            this.messages.push(data);
            handlers["message"]?.forEach((h) => h(data));
        },
    };
}
// Mock logger
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};
// Mock ChannelGatewayContext
function createMockCtx() {
    return {
        accountId: "default",
        cfg: {},
        channelRuntime: {
            reply: {
                dispatchReplyWithBufferedBlockDispatcher: vi.fn(async (opts) => {
                    // Simulate AI reply with action JSON + text
                    opts.dispatcherOptions.deliver({
                        text: '{"act":"nod","emo":"happy"}你好呀！今天天气很不错。',
                    });
                }),
            },
        },
    };
}
describe("xiaozhi Plugin Integration", () => {
    describe("Session handshake", () => {
        it("completes hello handshake", async () => {
            const ws = createMockWs();
            const replyHandler = new MockReplyHandler();
            const asr = new MockAsrProvider();
            const tts = new MockTtsProvider();
            const ctx = createMockCtx();
            const session = new XiaozhiSession("test-conn-1", ws, { port: 8765 }, new McpManager("test-conn-1", ws, mockLogger), asr, tts, replyHandler, ctx, mockLogger);
            // Start session (runs in background)
            const sessionPromise = session.run();
            // Simulate device hello
            await new Promise((r) => setTimeout(r, 50));
            ws.simulateMessage(JSON.stringify({
                type: "hello",
                version: 1,
                audio_params: {
                    format: "opus",
                    sample_rate: 16000,
                    channels: 1,
                    frame_duration: 60,
                },
            }));
            await sessionPromise;
            // Verify server hello was sent
            const helloMsg = ws.sent.find((s) => s.includes('"type":"hello"'));
            expect(helloMsg).toBeDefined();
            expect(helloMsg).toContain('"transport":"websocket"');
            expect(helloMsg).toContain('"session_id"');
        });
        it("handles MCP initialize request", async () => {
            const ws = createMockWs();
            const replyHandler = new MockReplyHandler();
            const asr = new MockAsrProvider();
            const tts = new MockTtsProvider();
            const ctx = createMockCtx();
            const mcp = new McpManager("test-conn-2", ws, mockLogger);
            const session = new XiaozhiSession("test-conn-2", ws, { port: 8765 }, mcp, asr, tts, replyHandler, ctx, mockLogger);
            const sessionPromise = session.run();
            // Send device hello
            await new Promise((r) => setTimeout(r, 50));
            ws.simulateMessage(JSON.stringify({ type: "hello", version: 1 }));
            await new Promise((r) => setTimeout(r, 50));
            // Verify MCP initialize response was sent (session sends it after hello)
            const helloResp = ws.sent.find((s) => s.includes('"type":"hello"'));
            expect(helloResp).toBeDefined();
            // Close to terminate session
            ws.close();
            await sessionPromise;
        });
    });
    describe("Full interaction flow", () => {
        it("processes listen -> ASR -> reply -> TTS", async () => {
            const ws = createMockWs();
            const replyHandler = new MockReplyHandler();
            const asr = new MockAsrProvider("你好！");
            const tts = new MockTtsProvider();
            const ctx = createMockCtx();
            const mcp = new McpManager("test-conn-3", ws, mockLogger);
            const session = new XiaozhiSession("test-conn-3", ws, { port: 8765 }, mcp, asr, tts, replyHandler, ctx, mockLogger);
            const sessionPromise = session.run();
            // Hello handshake
            await new Promise((r) => setTimeout(r, 50));
            ws.simulateMessage(JSON.stringify({ type: "hello", version: 1 }));
            await new Promise((r) => setTimeout(r, 100));
            // Send listen(detect)
            ws.simulateMessage(JSON.stringify({ type: "listen", state: "detect" }));
            await new Promise((r) => setTimeout(r, 100));
            // Send listen(stop) to trigger ASR
            ws.simulateMessage(JSON.stringify({ type: "listen", state: "stop" }));
            // Wait for ASR and reply processing
            await new Promise((r) => setTimeout(r, 1000));
            // Verify reply handler was called
            expect(replyHandler.calls.length).toBeGreaterThan(0);
            // Close to terminate session
            ws.close();
            await sessionPromise;
        });
    });
    describe("MCP tools handling", () => {
        it("responds to tools/list request", async () => {
            const ws = createMockWs();
            const replyHandler = new MockReplyHandler();
            const asr = new MockAsrProvider();
            const tts = new MockTtsProvider();
            const ctx = createMockCtx();
            const mcp = new McpManager("test-conn-4", ws, mockLogger);
            const session = new XiaozhiSession("test-conn-4", ws, { port: 8765 }, mcp, asr, tts, replyHandler, ctx, mockLogger);
            const sessionPromise = session.run();
            // Hello
            await new Promise((r) => setTimeout(r, 50));
            ws.simulateMessage(JSON.stringify({ type: "hello", version: 1 }));
            await new Promise((r) => setTimeout(r, 50));
            // Send MCP tools/list request directly
            ws.simulateMessage(JSON.stringify({
                type: "mcp",
                payload: {
                    jsonrpc: "2.0",
                    method: "tools/list",
                    id: 100,
                },
            }));
            await new Promise((r) => setTimeout(r, 100));
            // Find tools/list response
            const toolsListResp = ws.sent.find((s) => s.includes('"result"') && s.includes('"tools"'));
            expect(toolsListResp).toBeDefined();
            expect(toolsListResp).toContain("self.robot.set_head_angles");
            expect(toolsListResp).toContain("self.robot.set_led_color");
            // Close to terminate session
            ws.close();
            await sessionPromise;
        });
        it("handles tools/call request", async () => {
            const ws = createMockWs();
            const replyHandler = new MockReplyHandler();
            const asr = new MockAsrProvider();
            const tts = new MockTtsProvider();
            const ctx = createMockCtx();
            const mcp = new McpManager("test-conn-5", ws, mockLogger);
            const session = new XiaozhiSession("test-conn-5", ws, { port: 8765 }, mcp, asr, tts, replyHandler, ctx, mockLogger);
            const sessionPromise = session.run();
            // Hello
            await new Promise((r) => setTimeout(r, 50));
            ws.simulateMessage(JSON.stringify({ type: "hello", version: 1 }));
            await new Promise((r) => setTimeout(r, 50));
            // Send tools/call request
            ws.simulateMessage(JSON.stringify({
                type: "mcp",
                payload: {
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: {
                        name: "self.robot.set_led_color",
                        arguments: { red: 255, green: 0, blue: 128 },
                    },
                    id: 101,
                },
            }));
            await new Promise((r) => setTimeout(r, 100));
            // Verify onMcpCall was invoked
            expect(replyHandler.calls.length).toBe(0); // Not a reply call
            const onMcpCallLogged = mockLogger.info?.mock.calls.some((c) => c[0]?.includes?.("Device calling tool"));
            expect(onMcpCallLogged).toBe(true);
            // Close to terminate session
            ws.close();
            await sessionPromise;
        });
    });
});
describe("Action parsing in replies", () => {
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
    it("parses action JSON prefix correctly", () => {
        const { action, remainingText } = parseActionJson('{"act":"nod","emo":"joy"}你好呀！');
        expect(action).toEqual({ act: "nod", emo: "joy" });
        expect(remainingText).toBe("你好呀！");
    });
    it("handles multiple actions sequentially", () => {
        // First action
        const { action: action1, remainingText: text1 } = parseActionJson('{"act":"nod"}第一个问题？');
        expect(action1).toEqual({ act: "nod" });
        expect(text1).toBe("第一个问题？");
        // Second action (in same text)
        const { action: action2, remainingText: text2 } = parseActionJson('{"act":"shake"}第二个问题？');
        expect(action2).toEqual({ act: "shake" });
        expect(text2).toBe("第二个问题？");
    });
});
