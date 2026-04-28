/**
 * Xiaozhi Channel Plugin
 * 实现小智协议，用于连接 ESP32 桌面机器人
 */

import type { ChannelPlugin, Logger } from "openclaw/plugin-sdk";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import { XiaozhiServer } from "./server.js";
import type { TtsProvider } from "./session.js";
import type { McpManager } from "./mcp-manager.js";
import type { WebSocketLike } from "./mcp-manager.js";

interface XiaozhiAccount {
  accountId: string;
  configured: boolean;
  enabled: boolean;
}

const xiaozhiConfigSchema = {
  type: "object" as const,
  properties: {
    port: { type: "number", default: 8765 },
    asr: { type: "object" },
    tts: { type: "object" },
  },
  additionalProperties: false,
};

/**
 * OpenClawReplyHandler - 实现 ReplyHandler 接口
 *
 * 工作流程：
 * 1. 收到 ASR 文本后，调用 OpenClaw 的 reply pipeline
 * 2. OpenClaw 返回的 text 经过我们解析：提取动作 JSON 前缀
 * 3. 动作立刻通过 MCP 发给 ESP32（并发）
 * 4. 文本部分通过 TTS 流式播放给 ESP32
 */
class OpenClawReplyHandler {
  private abortEvent = false;

  async reply(
    text: string,
    mcp: McpManager,
    tts: TtsProvider,
    ws: WebSocketLike,
    log: Logger,
    ctx: ChannelGatewayContext<XiaozhiAccount>,
  ): Promise<void> {
    this.abortEvent = false;
    log.info?.(`Dispatching to OpenClaw: ${text.slice(0, 50)}...`);

    // 检查 channelRuntime 是否可用
    if (!ctx.channelRuntime) {
      log.warn?.("channelRuntime not available - cannot use AI reply pipeline");
      return;
    }

    const replyDispatcher = ctx.channelRuntime.reply;

    // 构建 MsgContext
    const msgCtx = {
      Body: text,
      BodyForAgent: text,
      SessionKey: `xiaozhi:${ctx.accountId}:session`,
      AccountId: ctx.accountId,
      From: "esp32",
      To: "openclaw",
    };

    // 调用 OpenClaw 的 reply pipeline
    await replyDispatcher.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx,
      cfg: ctx.cfg,
      dispatcherOptions: {
        deliver: async (payload, _info) => {
          // payload.text 可能包含动作 JSON 前缀
          const replyText = payload.text ?? "";

          // 解析动作 JSON 前缀
          const { action, remainingText } = this.parseActionJson(replyText);

          // 1. 立刻发送动作（并发）
          if (action) {
            void this.executeAction(action, mcp, log);
          }

          // 2. TTS 流式播放
          await this.streamTts(remainingText, tts, ws, log);
        },
      },
    });
  }

  async abort(): Promise<void> {
    this.abortEvent = true;
    await new Promise((r) => setTimeout(r, 100));
    this.abortEvent = false;
  }

  private parseActionJson(text: string): { action: ActionJson | null; remainingText: string } {
    const match = text.match(/^\s*\{[^}]+\}\s*/);
    if (match) {
      try {
        const action = JSON.parse(match[0]) as ActionJson;
        return { action, remainingText: text.slice(match[0].length) };
      } catch {
        // Not valid JSON
      }
    }
    return { action: null, remainingText: text };
  }

  private async executeAction(action: ActionJson, mcp: McpManager, log: Logger): Promise<void> {
    const act = action.act ?? "idle";
    const emo = action.emo ?? "neutral";
    const spd = action.spd ?? 180;

    log.info?.(`Executing action: act=${act} emo=${emo} spd=${spd}`);

    // 表情 → LED
    const led = EMOTION_TO_LED[emo];
    if (led && led.some((v) => v > 0)) {
      void mcp.callTool("self.robot.set_led_color", { red: led[0], green: led[1], blue: led[2] });
    }

    // 动作序列
    const steps = ACTION_MAP[act] ?? [];
    for (const step of steps) {
      if (this.abortEvent) break;
      if (Array.isArray(step) && step[0] === "sleep") {
        await new Promise((r) => setTimeout(r, step[1] as number));
      } else if (typeof step === "object" && step !== null) {
        const args = { ...(step as { arguments?: Record<string, unknown> }).arguments };
        if (!("speed" in args)) {
          args.speed = spd;
        }
        await mcp.callTool((step as { name: string }).name, args);
      }
    }
  }

  private async streamTts(text: string, tts: TtsProvider, ws: WebSocketLike, log: Logger): Promise<void> {
    if (!text.trim()) return;

    try {
      await ws.send(JSON.stringify({ type: "tts", state: "start" }));

      const sentences = this.splitSentences(text);
      for (const sent of sentences) {
        if (this.abortEvent) break;
        if (!sent.trim()) continue;

        await ws.send(JSON.stringify({ type: "tts", state: "sentence_start", text: sent }));

        for await (const audio of tts.synthesizeStream(sent)) {
          if (this.abortEvent) break;
          await ws.send(audio);
        }

        await ws.send(JSON.stringify({ type: "tts", state: "sentence_end" }));
      }

      await ws.send(JSON.stringify({ type: "tts", state: "stop" }));
    } catch (err) {
      log.error?.(`TTS error: ${err}`);
    }
  }

  private splitSentences(text: string): string[] {
    const parts = text.split(/(?<=[。！？…\n])/);
    const sentences: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i + 1 < parts.length && /[。！？…\n]/.test(parts[i + 1]?.[0] ?? "")) {
        sentences.push(parts[i] + parts[i + 1]);
        i++;
      } else if (parts[i]) {
        sentences.push(parts[i]);
      }
    }
    return sentences;
  }
}

interface ActionJson {
  act?: string;
  emo?: string;
  spd?: number;
}

const EMOTION_TO_LED: Record<string, [number, number, number]> = {
  joy: [80, 80, 0],
  happy: [60, 80, 0],
  sad: [0, 0, 80],
  angry: [120, 0, 0],
  surprised: [80, 40, 80],
  thinking: [0, 40, 80],
  neutral: [0, 0, 0],
  speaking: [0, 60, 40],
};

const ACTION_MAP: Record<string, Array<{ name: string; arguments: Record<string, unknown> } | ["sleep", number]>> = {
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

export const xiaozhiPlugin: ChannelPlugin<XiaozhiAccount> = {
  id: "xiaozhi",
  meta: {
    id: "xiaozhi",
    name: "Xiaozhi",
    description: "Xiaozhi Protocol for ESP32 robots",
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
    setAccountEnabled: () => {},
    deleteAccount: () => {},
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
      const config = ctx.cfg.channels?.xiaozhi ?? {};

      const xiaozhiConfig = {
        port: config.port ?? 8765,
        asr: config.asr,
        tts: config.tts,
      };

      // 创建 reply handler，传入 ctx 以访问 channelRuntime
      const replyHandler = new OpenClawReplyHandler();
      const server = new XiaozhiServer(xiaozhiConfig, replyHandler, ctx, log);
      await server.start(xiaozhiConfig.port);

      log.info?.(`Xiaozhi gateway started on port ${xiaozhiConfig.port}`);
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