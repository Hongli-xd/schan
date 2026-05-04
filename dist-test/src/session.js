/**
 * Xiaozhi Session - Per-connection state machine
 *
 * Complete xiaozhi protocol implementation based on xiaozhi-esp32 firmware.
 *
 * State machine:
 *   idle → listening → processing → responding → idle
 *
 * Reference: xiaozhi-esp32/main/application.cc
 */
import { STACKCHAN_MCP_TOOLS } from "./protocol.js";
var SessionState;
(function (SessionState) {
    SessionState["IDLE"] = "idle";
    SessionState["LISTENING"] = "listening";
    SessionState["PROCESSING"] = "processing";
    SessionState["RESPONDING"] = "responding";
})(SessionState || (SessionState = {}));
export class XiaozhiSession {
    connectionId;
    ws;
    config;
    mcp;
    asr;
    tts;
    replyHandler;
    ctx;
    log;
    audioQueue = new AudioQueue();
    state = SessionState.IDLE;
    sessionId = "";
    deviceSessionId = "";
    protocolVersion = 1;
    audioParams = { format: "opus", sample_rate: 16000, channels: 1, frame_duration: 60 };
    currentAsrTask = null;
    abortEvent = false;
    constructor(connectionId, ws, config, mcp, asr, tts, replyHandler, ctx, log) {
        this.connectionId = connectionId;
        this.ws = ws;
        this.config = config;
        this.mcp = mcp;
        this.asr = asr;
        this.tts = tts;
        this.replyHandler = replyHandler;
        this.ctx = ctx;
        this.log = log;
    }
    async run() {
        await this.waitForHello();
        this.log.info?.(`[${this.connectionId}] Session ready, protocol v${this.protocolVersion}`);
        this.ws.on("message", (data) => {
            void this.handleMessage(data);
        });
        this.ws.on("close", () => {
            this.log.info?.(`[${this.connectionId}] Connection closed`);
        });
    }
    async waitForHello() {
        const raw = await this.recv();
        const hello = JSON.parse(raw);
        if (hello.type !== "hello") {
            throw new Error(`Expected hello, got ${hello.type}`);
        }
        this.log.info?.(`[${this.connectionId}] Device hello: ${JSON.stringify(hello)}`);
        this.deviceSessionId = hello.session_id ?? "";
        this.protocolVersion = hello.version ?? 1;
        if (hello.audio_params) {
            this.audioParams = hello.audio_params;
        }
        this.sessionId = this.generateSessionId();
        const serverHello = {
            type: "hello",
            transport: "websocket",
            session_id: this.sessionId,
            audio_params: this.audioParams,
        };
        await this.sendJson(serverHello);
        this.log.info?.(`[${this.connectionId}] Server hello sent, session_id: ${this.sessionId}`);
    }
    generateSessionId() {
        return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    async handleMessage(data) {
        if (data instanceof Buffer) {
            await this.handleBinary(data);
        }
        else if (typeof data === "string") {
            await this.handleText(data);
        }
    }
    async handleBinary(data) {
        if (this.protocolVersion === 2 && data.length >= 14) {
            const version = data.readUInt16BE(0);
            if (version === 2) {
                const type = data.readUInt16BE(2);
                const payloadSize = data.readUInt32BE(10);
                if (data.length >= 14 + payloadSize) {
                    const payload = data.subarray(14, 14 + payloadSize);
                    if (type === 0 && this.state === SessionState.LISTENING) {
                        this.audioQueue.push(payload);
                    }
                }
                return;
            }
        }
        if (this.protocolVersion === 3 && data.length >= 4) {
            const type = data[0];
            const payloadSize = data.readUInt16BE(2);
            if (data.length >= 4 + payloadSize) {
                const payload = data.subarray(4, 4 + payloadSize);
                if (type === 0 && this.state === SessionState.LISTENING) {
                    this.audioQueue.push(payload);
                }
                return;
            }
        }
        if (this.state === SessionState.LISTENING) {
            this.audioQueue.push(data);
        }
    }
    async handleText(raw) {
        try {
            const msg = JSON.parse(raw);
            this.log.debug?.(`[${this.connectionId}] JSON msg: ${msg.type}`);
            switch (msg.type) {
                case "hello":
                    this.log.warn?.(`[${this.connectionId}] Unexpected hello after handshake`);
                    break;
                case "listen":
                    await this.onListen(msg);
                    break;
                case "abort":
                    await this.onAbort();
                    break;
                case "stt":
                    this.log.info?.(`[${this.connectionId}] STT result: ${msg.text}`);
                    break;
                case "tts":
                    this.log.debug?.(`[${this.connectionId}] TTS state: ${msg.state}`);
                    break;
                case "llm": {
                    const llmMsg = msg;
                    if (llmMsg.emotion) {
                        this.log.info?.(`[${this.connectionId}] LLM emotion: ${llmMsg.emotion}`);
                    }
                    break;
                }
                case "mcp":
                    await this.onMcpMessage(msg);
                    break;
                case "system": {
                    const sysMsg = msg;
                    if (sysMsg.command === "reboot") {
                        this.log.info?.(`[${this.connectionId}] Reboot command received`);
                        await this.sendJson({ type: "system", command: "reboot" });
                    }
                    break;
                }
                case "alert":
                    this.log.info?.(`[${this.connectionId}] Alert: ${JSON.stringify(msg)}`);
                    break;
                case "custom":
                    this.log.debug?.(`[${this.connectionId}] Custom: ${JSON.stringify(msg)}`);
                    break;
                default:
                    this.log.warn?.(`[${this.connectionId}] Unknown message type: ${msg.type}`);
            }
        }
        catch (err) {
            this.log.warn?.(`[${this.connectionId}] Invalid JSON: ${raw.slice(0, 100)}`);
        }
    }
    async onMcpMessage(msg) {
        const { payload } = msg;
        // If payload has result or error, it's a response from device (for our calls)
        if (payload.result !== undefined || payload.error !== undefined) {
            this.mcp.onResult(payload);
            return;
        }
        // Otherwise it's a request from device - handle and respond
        const response = this.handleMcpRequest(payload);
        if (response) {
            const responseMsg = {
                session_id: msg.session_id ?? this.sessionId,
                type: "mcp",
                payload: response,
            };
            await this.sendJson(responseMsg);
        }
    }
    handleMcpRequest(req) {
        const { method, id } = req;
        switch (method) {
            case "initialize":
                return {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        protocolVersion: "2024-11-05",
                        serverInfo: { name: "openclaw-xiaozhi", version: "1.0" },
                        capabilities: { tools: { listChanged: false } },
                    },
                };
            case "tools/list": {
                const tools = STACKCHAN_MCP_TOOLS.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                }));
                return { jsonrpc: "2.0", id, result: { tools } };
            }
            case "tools/call": {
                const params = req.params;
                this.log.info?.(`[${this.connectionId}] Device calling tool: ${params.name}`);
                if (params.name) {
                    void this.replyHandler.onMcpCall(params.name, params.arguments ?? {});
                }
                return {
                    jsonrpc: "2.0",
                    id,
                    result: { content: [{ type: "text", text: "ok" }], isError: false },
                };
            }
            default:
                this.log.warn?.(`[${this.connectionId}] Unknown MCP method: ${method}`);
                return {
                    jsonrpc: "2.0",
                    id,
                    error: { code: -32601, message: `Method not found: ${method}` },
                };
        }
    }
    async onListen(msg) {
        if (msg.state === "detect") {
            this.log.info?.(`[${this.connectionId}] Listen started, wake word: ${msg.text ?? ""}`);
            this.state = SessionState.LISTENING;
            this.abortEvent = false;
            this.audioQueue.clear();
            if (this.currentAsrTask) {
                this.currentAsrTask = null;
            }
            this.currentAsrTask = this.asrLoop();
        }
        else if (msg.state === "stop") {
            this.log.info?.(`[${this.connectionId}] Listen stopped`);
            this.state = SessionState.IDLE;
            this.audioQueue.push(Buffer.alloc(0));
        }
    }
    async onAbort() {
        this.log.info?.(`[${this.connectionId}] Abort received`);
        this.abortEvent = true;
        this.state = SessionState.IDLE;
        this.currentAsrTask = null;
        this.audioQueue.clear();
        await this.replyHandler.abort();
        await this.sendJson({ type: "tts", state: "stop" });
    }
    async asrLoop() {
        this.log.info?.(`[${this.connectionId}] ASR loop started`);
        try {
            const audioIter = this.audioChunkIterable();
            const finalText = await this.asr.transcribe(audioIter);
            if (this.abortEvent)
                return;
            if (finalText?.trim()) {
                this.log.info?.(`[${this.connectionId}] STT: ${finalText}`);
                this.state = SessionState.PROCESSING;
                await this.sendJson({ type: "stt", text: finalText });
                await this.replyHandler.reply(finalText, this.mcp, this.tts, this.ws, this.log, this.ctx);
            }
            else {
                this.state = SessionState.IDLE;
            }
        }
        catch (err) {
            this.log.error?.(`[${this.connectionId}] ASR error: ${err}`);
            this.state = SessionState.IDLE;
            await this.sendJson({ type: "stt", text: "(识别失败，请重试)" });
        }
    }
    async *audioChunkIterable() {
        while (true) {
            const chunk = await this.audioQueue.wait();
            if (chunk.length === 0 || this.abortEvent)
                break;
            yield chunk;
        }
    }
    async sendJson(data) {
        return new Promise((resolve, reject) => {
            this.ws.send(JSON.stringify(data), (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    recv() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Handshake timeout")), 10000);
            this.ws.once("message", (data) => {
                clearTimeout(timeout);
                resolve(typeof data === "string" ? data : String(data));
            });
        });
    }
}
class AudioQueue {
    queue = [];
    waiting = [];
    push(chunk) {
        if (this.waiting.length > 0) {
            const w = this.waiting.shift();
            w.resolve(chunk);
        }
        else {
            this.queue.push(chunk);
        }
    }
    clear() {
        this.queue = [];
    }
    wait() {
        return new Promise((resolve) => {
            if (this.queue.length > 0) {
                resolve(this.queue.shift());
            }
            else {
                this.waiting.push({ resolve });
            }
        });
    }
}
