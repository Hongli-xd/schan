/**
 * Xiaozhi Channel Plugin
 * xiaozhi protocol for ESP32 robots
 *
 * Replaces xiaozhi cloud service with OpenClaw
 */
import { XiaozhiServer } from "./server.js";
const xiaozhiConfigSchema = {
    type: "object",
    properties: {
        port: { type: "number", default: 8765 },
        asr: { type: "object" },
        tts: { type: "object" },
    },
    additionalProperties: false,
};
/**
 * OpenClawReplyHandler - implements ReplyHandler interface
 *
 * Workflow:
 * 1. Receive ASR text, call OpenClaw reply pipeline
 * 2. Parse response for action JSON prefix
 * 3. Execute actions via MCP (concurrent)
 * 4. Stream TTS audio to ESP32
 */
class OpenClawReplyHandler {
    abortEvent = false;
    async reply(text, mcp, tts, ws, log, ctx) {
        this.abortEvent = false;
        log.warn?.(`[DEBUG] OpenClawReplyHandler.reply CALLED with: ${text.slice(0, 100)}...`);
        if (!ctx.channelRuntime) {
            log.warn?.("channelRuntime not available - cannot use AI reply pipeline");
            return;
        }
        const replyDispatcher = ctx.channelRuntime.reply;
        if (!replyDispatcher) {
            log.warn?.("reply dispatcher not available");
            return;
        }
        const msgCtx = {
            Body: text,
            BodyForAgent: text,
            SessionKey: `xiaozhi:${ctx.accountId}:session`,
            AccountId: ctx.accountId,
            From: "esp32",
            To: "openclaw",
        };
        await replyDispatcher.dispatchReplyWithBufferedBlockDispatcher({
            ctx: msgCtx,
            cfg: ctx.cfg,
            dispatcherOptions: {
                deliver: async (payload) => {
                    const replyText = payload.text ?? "";
                    const { action, remainingText } = this.parseActionJson(replyText);
                    if (action) {
                        void this.executeAction(action, mcp, log);
                    }
                    await this.streamTts(remainingText, tts, ws, log);
                },
            },
        });
    }
    async abort() {
        this.abortEvent = true;
        await new Promise((r) => setTimeout(r, 100));
        this.abortEvent = false;
    }
    async onMcpCall(name, args) {
        // Handle MCP calls from device
        // This is called when device calls tools on us (server)
        console.log(`[MCP] Device calling tool: ${name}`, args);
    }
    parseActionJson(text) {
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
    async executeAction(action, mcp, log) {
        const act = action.act ?? "idle";
        const emo = action.emo ?? "neutral";
        const spd = action.spd ?? 180;
        log.info?.(`Executing action: act=${act} emo=${emo} spd=${spd}`);
        // Emotion → LED
        const led = EMOTION_TO_LED[emo];
        if (led && led.some((v) => v > 0)) {
            void mcp.callTool("self.robot.set_led_color", { red: led[0], green: led[1], blue: led[2] });
        }
        // Action sequence
        const steps = ACTION_MAP[act] ?? [];
        for (const step of steps) {
            if (this.abortEvent)
                break;
            if (Array.isArray(step) && step[0] === "sleep") {
                await new Promise((r) => setTimeout(r, step[1]));
            }
            else if (typeof step === "object" && step !== null) {
                const args = { ...step.arguments };
                if (!("speed" in args)) {
                    args.speed = spd;
                }
                await mcp.callTool(step.name, args);
            }
        }
    }
    async streamTts(text, tts, ws, log) {
        if (!text.trim())
            return;
        try {
            await ws.send(JSON.stringify({ type: "tts", state: "start" }));
            const sentences = this.splitSentences(text);
            for (const sent of sentences) {
                if (this.abortEvent)
                    break;
                if (!sent.trim())
                    continue;
                await ws.send(JSON.stringify({ type: "tts", state: "sentence_start", text: sent }));
                let chunkIdx = 0;
                for await (const audio of tts.synthesizeStream(sent)) {
                    if (this.abortEvent)
                        break;
                    if (audio.length > 0) {
                        chunkIdx++;
                        log.debug?.(`[TTS] streaming chunk ${chunkIdx}: ${audio.length} bytes`);
                    }
                    await new Promise((resolve, reject) => {
                        ws.send(audio, (err) => {
                            if (err)
                                reject(err);
                            else
                                resolve();
                        });
                    });
                }
                log.info?.(`[TTS] streamed ${chunkIdx} chunks for sentence: ${sent.slice(0, 20)}`);
                await ws.send(JSON.stringify({ type: "tts", state: "sentence_end" }));
            }
            await ws.send(JSON.stringify({ type: "tts", state: "stop" }));
        }
        catch (err) {
            log.error?.(`TTS error: ${err}`);
        }
    }
    splitSentences(text) {
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
}
const EMOTION_TO_LED = {
    joy: [80, 80, 0],
    happy: [60, 80, 0],
    sad: [0, 0, 80],
    angry: [120, 0, 0],
    surprised: [80, 40, 80],
    thinking: [0, 40, 80],
    neutral: [0, 0, 0],
    speaking: [0, 60, 40],
};
const ACTION_MAP = {
    nod: [
        { name: "self.robot.set_head_angles", arguments: { pitch: 20, speed: 180 } },
        ["sleep", 0.35],
        { name: "self.robot.set_head_angles", arguments: { pitch: 0, speed: 180 } },
    ],
    shake: [
        { name: "self.robot.set_head_angles", arguments: { yaw: 25, speed: 200 } },
        ["sleep", 0.25],
        { name: "self.robot.set_head_angles", arguments: { yaw: -25, speed: 200 } },
        ["sleep", 0.25],
        { name: "self.robot.set_head_angles", arguments: { yaw: 0, speed: 200 } },
    ],
    look_left: [{ name: "self.robot.set_head_angles", arguments: { yaw: -35, speed: 160 } }],
    look_right: [{ name: "self.robot.set_head_angles", arguments: { yaw: 35, speed: 160 } }],
    look_up: [{ name: "self.robot.set_head_angles", arguments: { pitch: 30, speed: 160 } }],
    look_down: [{ name: "self.robot.set_head_angles", arguments: { pitch: -10, speed: 160 } }],
    idle: [],
};
export const xiaozhiPlugin = {
    id: "xiaozhi",
    meta: {
        id: "xiaozhi",
        name: "Xiaozhi",
        description: "Xiaozhi Protocol for ESP32 robots - OpenClaw replacement for xiaozhi cloud",
    },
    configSchema: xiaozhiConfigSchema,
    capabilities: {
        chatTypes: ["direct"],
        media: false,
        reactions: false,
    },
    config: {
        listAccountIds: () => ["default"],
        resolveAccount: () => ({
            accountId: "default",
            configured: true,
            enabled: true,
        }),
        defaultAccountId: () => "default",
        setAccountEnabled: () => { },
        deleteAccount: () => { },
        isConfigured: (account) => account.configured,
        describeAccount: (account) => ({
            accountId: account.accountId,
            name: "Xiaozhi",
            enabled: account.enabled,
            configured: account.configured,
            baseUrl: null,
        }),
    },
    gateway: {
        async startAccount(ctx) {
            const log = ctx.log ?? console;
            const config = (ctx.cfg.channels?.xiaozhi ?? {});
            const xiaozhiConfig = {
                port: config.port ?? 8765,
                asr: config.asr,
                tts: config.tts,
            };
            const replyHandler = new OpenClawReplyHandler();
            const server = new XiaozhiServer(xiaozhiConfig, replyHandler, ctx, log);
            await server.start(xiaozhiConfig.port);
            log.info?.(`Xiaozhi gateway started on port ${xiaozhiConfig.port}`);
            // Keep running until aborted (prevents gateway from thinking task is complete)
            await new Promise((resolve) => {
                const sig = ctx.abortSignal;
                sig?.addEventListener("abort", () => {
                    server.stop();
                    resolve();
                });
            });
        },
        async stopAccount(ctx) {
            // Trigger abort to unblock the Promise in startAccount
            ctx._abortController?.abort();
        },
    },
    outbound: {
        deliveryMode: "direct",
        sendText: async () => {
            return { channel: "xiaozhi", messageId: "unsupported" };
        },
    },
    status: {
        defaultRuntime: { status: "unknown", lastProbeAt: null },
        collectStatusIssues: () => [],
        buildChannelSummary: () => ({ status: "ready" }),
        probeAccount: async () => ({ ok: true }),
        buildAccountSnapshot: () => ({ status: "ready", configured: true, enabled: true }),
    },
};
