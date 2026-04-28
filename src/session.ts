/**
 * Session - 每个 ESP32 连接的完整生命周期
 * 实现小智协议状态机：hello → listen → stt → dispatch → tts
 */

import type { Logger } from "openclaw/plugin-sdk";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import type { WebSocketLike } from "./mcp-manager.js";
import type { McpManager } from "./mcp-manager.js";
import type { XiaozhiJsonMessage } from "./protocol.js";

export interface AsrProvider {
  transcribe(audio: AsyncIterable<Buffer>): Promise<string>;
}

export interface TtsProvider {
  synthesizeStream(text: string): AsyncIterable<Buffer>;
}

export interface XiaozhiConfig {
  port: number;
  asr?: unknown;
  tts?: unknown;
}

interface XiaozhiAccount {
  accountId: string;
  configured: boolean;
  enabled: boolean;
}

export class XiaozhiSession {
  private audioQueue = new AudioQueue();
  private listening = false;
  private currentAsrTask: Promise<void> | null = null;
  private ws: WebSocketLike;

  constructor(
    private sessionId: string,
    ws: WebSocketLike,
    private config: XiaozhiConfig,
    private mcp: McpManager,
    private asr: AsrProvider,
    private tts: TtsProvider,
    private replyHandler: ReplyHandler,
    private ctx: ChannelGatewayContext<XiaozhiAccount>,
    private log: Logger,
  ) {
    this.ws = ws;
  }

  async run(): Promise<void> {
    // 1. 握手
    await this.handshake();

    // 2. MCP 工具发现
    await this.mcp.initialize();

    // 3. 消息循环 - WebSocketLike 使用事件而非 for-await
    this.ws.on("message", (data: unknown) => {
      void this.handleMessage(data);
    });

    this.ws.on("close", () => {
      this.log.info?.(`[${this.sessionId}] WebSocket closed`);
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    if (data instanceof Buffer) {
      // Opus 音频帧
      if (this.listening) {
        this.audioQueue.push(data);
      }
    } else if (typeof data === "string") {
      try {
        const msg = JSON.parse(data) as XiaozhiJsonMessage;
        await this.handleJson(msg);
      } catch {
        this.log.warn?.(`[${this.sessionId}] Invalid JSON: ${data.slice(0, 100)}`);
      }
    }
  }

  private async handshake(): Promise<void> {
    const raw = await this.recv();
    const msg = JSON.parse(raw);

    if (msg.type !== "hello") {
      throw new Error(`Expected hello, got ${msg.type}`);
    }

    this.log.info?.(`[${this.sessionId}] Received hello: ${JSON.stringify(msg)}`);

    await this.send({
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
    });

    this.log.info?.(`[${this.sessionId}] Handshake complete`);
  }

  private async handleJson(msg: XiaozhiJsonMessage): Promise<void> {
    switch (msg.type) {
      case "listen":
        await this.onListen(msg);
        break;
      case "abort":
        await this.onAbort();
        break;
      case "mcp":
        this.mcp.onResult(msg.payload as { id?: number | string; result?: unknown });
        break;
      case "iot":
        this.log.debug?.(`[${this.sessionId}] IoT update: ${JSON.stringify(msg)}`);
        break;
    }
  }

  private async onListen(msg: { state: string; text?: string }): Promise<void> {
    if (msg.state === "detect") {
      this.log.info?.(`[${this.sessionId}] Listen started, wake word: ${msg.text ?? ""}`);
      this.listening = true;
      this.audioQueue.clear();

      if (this.currentAsrTask) {
        this.currentAsrTask = null;
      }

      this.currentAsrTask = this.asrLoop();
    } else if (msg.state === "stop") {
      this.log.info?.(`[${this.sessionId}] Listen stopped by device`);
      this.listening = false;
      this.audioQueue.push(Buffer.alloc(0)); // sentinel
    }
  }

  private async onAbort(): Promise<void> {
    this.log.info?.(`[${this.sessionId}] Abort received`);
    this.listening = false;
    this.currentAsrTask = null;
    await this.replyHandler.abort();
    await this.send({ type: "tts", state: "stop" });
  }

  private async asrLoop(): Promise<void> {
    this.log.info?.(`[${this.sessionId}] ASR loop started`);
    try {
      const audioIter = this.audioChunkIterable();
      const finalText = await this.asr.transcribe(audioIter);

      if (finalText?.trim()) {
        this.log.info?.(`[${this.sessionId}] STT final: ${finalText}`);
        this.listening = false;

        // 回显给 ESP32 屏幕显示
        await this.send({ type: "stt", text: finalText });

        // 交给 OpenClaw 处理，replyHandler 会处理动作+TTS
        await this.replyHandler.reply(finalText, this.mcp, this.tts, this.ws, this.log, this.ctx);
      }
    } catch (err) {
      this.log.error?.(`[${this.sessionId}] ASR error: ${err}`);
      await this.send({ type: "stt", text: "(识别失败，请重试)" });
    }
  }

  private async *audioChunkIterable(): AsyncIterable<Buffer> {
    while (true) {
      const chunk = await this.audioQueue.wait();
      if (chunk.length === 0) break;
      yield chunk;
    }
  }

  private send(data: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(data), (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private recv(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Handshake timeout")), 10000);
      this.ws.once("message", (data: unknown) => {
        clearTimeout(timeout);
        resolve(typeof data === "string" ? data : String(data));
      });
    });
  }
}

class AudioQueue {
  private queue: Buffer[] = [];
  private waiting: Array<{ resolve: (chunk: Buffer) => void }> = [];

  push(chunk: Buffer): void {
    if (this.waiting.length > 0) {
      const w = this.waiting.shift()!;
      w.resolve(chunk);
    } else {
      this.queue.push(chunk);
    }
  }

  clear(): void {
    this.queue = [];
  }

  wait(): Promise<Buffer> {
    return new Promise((resolve) => {
      if (this.queue.length > 0) {
        resolve(this.queue.shift()!);
      } else {
        this.waiting.push({ resolve });
      }
    });
  }
}

/**
 * ReplyHandler - 处理 OpenClaw 回复
 * 插件只管接收消息、发送回复；agent/记忆等由 OpenClaw 内部处理
 */
export interface ReplyHandler {
  reply(
    text: string,
    mcp: McpManager,
    tts: TtsProvider,
    ws: WebSocketLike,
    log: Logger,
    ctx: ChannelGatewayContext<XiaozhiAccount>,
  ): Promise<void>;
  abort(): Promise<void>;
}