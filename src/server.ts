/**
 * WebSocket Server - 实现完整小智协议
 * 每个连接创建一个 Session
 */

import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import type { Logger } from "openclaw/plugin-sdk";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import type { WebSocketLike } from "./mcp-manager.js";
import type { XiaozhiConfig, ReplyHandler } from "./session.js";
import { XiaozhiSession } from "./session.js";
import { McpManager } from "./mcp-manager.js";
import { createAsrProvider } from "./providers/asr.js";
import { createTtsProvider } from "./providers/tts.js";

interface XiaozhiAccount {
  accountId: string;
  configured: boolean;
  enabled: boolean;
}

export class XiaozhiServer {
  private wss: WebSocketServer;
  private sessions = new Map<string, XiaozhiSession>();

  constructor(
    private config: XiaozhiConfig,
    private replyHandler: ReplyHandler,
    private ctx: ChannelGatewayContext<XiaozhiAccount>,
    private log: Logger,
  ) {
    const httpServer = createServer();
    this.wss = new WebSocketServer({ server: httpServer, maxPayload: 10 * 1024 * 1024 });

    this.wss.on("connection", (ws, path) => {
      this.handleConnection(ws, path);
    });

    (this as unknown as { _server?: HttpServer })._server = httpServer;
  }

  private handleConnection(ws: import("ws").WebSocket, path: string): void {
    const sessionId = Math.random().toString(36).slice(2, 10);
    this.log.info?.(`[${sessionId}] ESP32 connected from ${ws.socket.remoteAddress}`);

    // Wrap ws to match WebSocketLike interface
    const wsLike: WebSocketLike = {
      send(data, cb) {
        if (typeof data === "string") {
          ws.send(data, cb);
        } else {
          ws.send(data, cb);
        }
      },
      on(event, listener) {
        ws.on(event, listener as (...args: unknown[]) => void);
      },
      once(event, listener) {
        ws.once(event, listener as (...args: unknown[]) => void);
      },
      close() {
        ws.close();
      },
    };

    const mcp = new McpManager(sessionId, wsLike, this.log);
    const asr = createAsrProvider(this.config.asr, this.log);
    const tts = createTtsProvider(this.config.tts, this.log);

    const session = new XiaozhiSession(
      sessionId,
      wsLike,
      this.config,
      mcp,
      asr,
      tts,
      this.replyHandler,
      this.ctx,
      this.log,
    );

    this.sessions.set(sessionId, session);

    session.run().catch((err) => {
      this.log.error?.(`[${sessionId}] Unexpected error: ${err}`);
    }).finally(() => {
      this.sessions.delete(sessionId);
      this.log.info?.(`[${sessionId}] Session cleaned up`);
    });
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      const server = (this as unknown as { _server?: HttpServer })._server!;
      server.listen(port, () => {
        this.log.info?.(`Xiaozhi server listening on ws://0.0.0.0:${port}`);
        resolve();
      });
    });
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      // Sessions clean up on close
    }
    this.wss.close();
  }
}