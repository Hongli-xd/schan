/**
 * MCP Manager - 与 ESP32 的 MCP 工具交互
 * 方向：OpenClaw（client）→ ESP32（server）
 */

import type { Logger } from "openclaw/plugin-sdk";
import type {
  McpJsonRpcMessage,
  McpTool,
} from "./protocol.js";

/** Minimal WebSocket interface we use */
export interface WebSocketLike {
  send(data: string | Uint8Array, cb?: (err?: Error) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  close(): void;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class McpManager {
  private callId = 0;
  private pending = new Map<number, PendingCall>();
  private tools: McpTool[] = [];
  private toolSchemas: Array<{
    type: "function";
    function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } };
  }> = [];

  constructor(
    private sessionId: string,
    private ws: WebSocketLike,
    private log: Logger,
  ) {}

  getTools(): McpTool[] {
    return this.tools;
  }

  getToolSchemas(): Array<{ type: "function"; function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } } }> {
    return this.toolSchemas;
  }

  async initialize(): Promise<void> {
    try {
      // Step 1: initialize
      await this.sendMcp({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "openclaw-xiaozhi", version: "1.0" },
        },
        id: this.nextId(),
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 2: tools/list
      await this.sendMcp({
        jsonrpc: "2.0",
        method: "tools/list",
        id: this.nextId(),
      });

      // Wait briefly for tools/list response
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("tools/list timeout")), 5000);
          const check = () => {
            if (this.tools.length > 0) {
              clearTimeout(timeout);
              resolve(undefined);
            } else {
              setTimeout(check, 100);
            }
          };
          check();
        });
      } catch {
        this.log.warn?.(`[${this.sessionId}] MCP tools/list timeout, continuing without tools`);
      }

      this.log.info?.(`[${this.sessionId}] MCP tools discovered: ${this.tools.map((t) => t.name).join(", ") || "none"}`);
    } catch (err) {
      this.log.warn?.(`[${this.sessionId}] MCP init failed: ${err}`);
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const callId = this.nextId();

    const result = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`MCP tool ${name} call timeout`));
      }, 3000);

      this.pending.set(callId, { resolve, reject, timeout });

      this.sendMcp({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name, arguments: args },
        id: callId,
      }).catch((err) => {
        clearTimeout(timeout);
        this.pending.delete(callId);
        reject(err);
      });
    });

    this.log.debug?.(`MCP tool ${name} result: ${JSON.stringify(result)}`);
    return result;
  }

  onResult(payload: { id?: number | string; result?: unknown }): void {
    if (payload.id == null) return;
    const callId = Number(payload.id);
    const pending = this.pending.get(callId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(payload.result);
      this.pending.delete(callId);
    }

    // Handle tools/list response specially
    if (payload.result && typeof payload.result === "object" && "tools" in (payload.result as Record<string, unknown>)) {
      const result = payload.result as { tools?: McpTool[] };
      if (result.tools) {
        this.tools = result.tools;
        this.toolSchemas = this.tools.map((t) => this.toOpenAiSchema(t));
      }
    }
  }

  private nextId(): number {
    return ++this.callId;
  }

  private async sendMcp(payload: McpJsonRpcMessage): Promise<void> {
    const msg = JSON.stringify({ type: "mcp", payload });
    await new Promise<void>((resolve, reject) => {
      this.ws.send(msg, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private toOpenAiSchema(tool: McpTool): {
    type: "function";
    function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } };
  } {
    const inputSchema = tool.inputSchema ?? {};
    const properties = inputSchema.properties ?? {};
    const required = inputSchema.required ?? [];

    return {
      type: "function",
      function: {
        name: tool.name.replace(".", "_"),
        description: tool.description ?? "",
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(properties).map(([k, v]) => [
              k,
              { type: (v as { type?: string }).type ?? "string", description: (v as { description?: string }).description ?? "" },
            ]),
          ),
          required,
        },
      },
    };
  }
}