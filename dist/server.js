/**
 * WebSocket Server - xiaozhi protocol server
 *
 * Handles WebSocket connections from xiaozhi-esp32 devices
 * Validates headers and creates per-connection sessions
 *
 * Reference: xiaozhi-esp32/main/protocols/websocket_protocol.cc
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { XiaozhiSession } from "./session.js";
import { McpManager } from "./mcp-manager.js";
import { createAsrProvider } from "./providers/asr.js";
import { createTtsProvider } from "./providers/tts.js";
// Global port registry — keyed by port number
const portRegistry = new Map();
export class XiaozhiServer {
    config;
    replyHandler;
    ctx;
    log;
    wss;
    sessions = new Map();
    constructor(config, replyHandler, ctx, log) {
        this.config = config;
        this.replyHandler = replyHandler;
        this.ctx = ctx;
        this.log = log;
        const httpServer = createServer();
        this.wss = new WebSocketServer({
            server: httpServer,
            maxPayload: 10 * 1024 * 1024,
        });
        this.wss.on("connection", (ws, request) => {
            this.handleConnection(ws, request);
        });
        this._server = httpServer;
    }
    handleConnection(ws, request) {
        const connectionId = this.generateConnectionId();
        // Extract headers per xiaozhi-esp32 spec
        const headers = {
            authorization: String(request.headers.authorization ?? ""),
            protocolVersion: String(request.headers["protocol-version"] ?? ""),
            deviceId: String(request.headers["device-id"] ?? ""),
            clientId: String(request.headers["client-id"] ?? ""),
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
        const wsLike = {
            send(data, cb) {
                if (typeof data === "string") {
                    ws.send(data, cb);
                }
                else {
                    ws.send(data, { binary: true }, cb);
                }
            },
            on(event, listener) {
                ws.on(event, listener);
            },
            once(event, listener) {
                ws.once(event, listener);
            },
            close() {
                ws.close();
            },
        };
        const mcp = new McpManager(connectionId, wsLike, this.log);
        const asr = createAsrProvider(this.config.asr, this.log);
        const tts = createTtsProvider(this.config.tts, this.log);
        const session = new XiaozhiSession(connectionId, wsLike, this.config, mcp, asr, tts, this.replyHandler, this.ctx, this.log);
        this.sessions.set(connectionId, session);
        session.run().catch((err) => {
            this.log.error?.(`[${connectionId}] Unexpected error: ${err}`);
        }).finally(() => {
            this.sessions.delete(connectionId);
            this.log.info?.(`[${connectionId}] Session cleaned up`);
        });
    }
    generateConnectionId() {
        return Math.random().toString(36).slice(2, 10);
    }
    start(port) {
        if (portRegistry.get(port) === true) {
            this.log.info?.(`xiaozhi server already registered on port ${port}, skipping`);
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const server = this._server;
            const onError = (err) => {
                if (err.code === "EADDRINUSE") {
                    portRegistry.set(port, true);
                    this.log.info?.(`xiaozhi server already running on port ${port}, skipping`);
                    resolve();
                }
                else {
                    this.log.error?.(`xiaozhi server error: ${err}`);
                    reject(err);
                }
            };
            server.once("error", onError);
            server.listen(port, () => {
                portRegistry.set(port, true);
                this.log.info?.(`xiaozhi server listening on ws://0.0.0.0:${port}`);
                resolve();
            });
        });
    }
    stop() {
        for (const session of this.sessions.values()) {
            // Sessions clean up on close
        }
        this.wss.close();
        this._server?.close();
    }
}
