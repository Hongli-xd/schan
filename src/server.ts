/**
 * WebSocket Server - xiaozhi protocol server
 *
 * Handles WebSocket connections from xiaozhi-esp32 devices
 * Validates headers and creates per-connection sessions
 *
 * Reference: xiaozhi-esp32/main/protocols/websocket_protocol.cc
 */

import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
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

export interface XiaozhiWebSocketHeaders {
  authorization?: string;
  protocolVersion?: string;
  deviceId?: string;
  clientId?: string;
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
    this.wss = new WebSocketServer({
      server: httpServer,
      maxPayload: 10 * 1024 * 1024,
    });

    this.wss.on("connection", (ws: WebSocket, request) => {
      this.handleConnection(ws, request);
    });

    (this as unknown as { _server?: HttpServer })._server = httpServer;
  }

  private handleConnection(ws: WebSocket, request: import("http").IncomingMessage): void {
    const connectionId = this.generateConnectionId();

    // Extract headers per xiaozhi-esp32 spec
    const headers: XiaozhiWebSocketHeaders = {
      authorization: request.headers.authorization,
      protocolVersion: request.headers["protocol-version"],
      deviceId: request.headers["device-id"],
      clientId: request.headers["client-id"],
    };

    this.log.info?.(`[${connectionId}] Device connecting from ${request.socket.remoteAddress}`);
    this.log.info?.(`[${connectionId}] Headers: ${JSON.stringify(headers)}`);

    // Validate required headers
    if (!headers.deviceId) {
      this.log.warn?.(`[${connectionId}] Missing Device-Id header, closing`);
      ws.close(1008, "Missing Device-Id header");
      return;
    }

    // Wrap ws to match WebSocketLike interface
    const wsLike: WebSocketLike = {
      send(data, cb) {
        if (typeof data === "string") {
          ws.send(data, cb);
        } else {
          ws.send(data, { binary: true }, cb);
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

    const mcp = new McpManager(connectionId, wsLike, this.log);
    const asr = createAsrProvider(this.config.asr, this.log);
    const tts = createTtsProvider(this.config.tts, this.log);

    const session = new XiaozhiSession(
      connectionId,
      wsLike,
      this.config,
      mcp,
      asr,
      tts,
      this.replyHandler,
      this.ctx,
      this.log,
    );

    this.sessions.set(connectionId, session);

    session.run().catch((err) => {
      this.log.error?.(`[${connectionId}] Unexpected error: ${err}`);
    }).finally(() => {
      this.sessions.delete(connectionId);
      this.log.info?.(`[${connectionId}] Session cleaned up`);
    });
  }

  private generateConnectionId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      const server = (this as unknown as { _server?: HttpServer })._server!;
      server.listen(port, () => {
        this.log.info?.(`xiaozhi server listening on ws://0.0.0.0:${port}`);
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
