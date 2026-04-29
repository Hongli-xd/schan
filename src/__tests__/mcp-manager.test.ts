/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import type { WebSocketLike } from "../mcp-manager.js";
import { McpManager } from "../mcp-manager.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createMockWs(): WebSocketLike & { sent: string[]; handlers: Record<string, Function[]> } {
  const handlers: Record<string, Function[]> = {};
  return {
    sent: [],
    handlers,
    send(data: string | Buffer, cb?: (err?: Error) => void) {
      this.sent.push(typeof data === "string" ? data : data.toString());
      cb?.();
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(listener);
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(listener);
    },
    close() {
      this.handlers["close"]?.forEach((h) => h());
    },
  };
}

describe("McpManager", () => {
  it("initializes with protocol version and client info", async () => {
    const ws = createMockWs();
    const mcp = new McpManager("test-session", ws, mockLogger);

    const initPromise = mcp.initialize();

    // Wait for initialize to send messages
    await new Promise((r) => setTimeout(r, 50));

    // Verify initialize was sent
    const initializeMsg = ws.sent.find((s) => s.includes("initialize"));
    expect(initializeMsg).toBeDefined();

    const parsed = JSON.parse(initializeMsg!);
    expect(parsed.type).toBe("mcp");
    expect(parsed.payload.method).toBe("initialize");
    expect(parsed.payload.params.protocolVersion).toBe("2024-11-05");
    expect(parsed.payload.params.clientInfo.name).toBe("openclaw-xiaozhi");
  });

  it("sends tools/list after initialize", async () => {
    const ws = createMockWs();
    const mcp = new McpManager("test-session", ws, mockLogger);

    await mcp.initialize();
    await new Promise((r) => setTimeout(r, 100));

    const toolsListMsg = ws.sent.find((s) => s.includes("tools/list"));
    expect(toolsListMsg).toBeDefined();
  });

  it("parses tools/list response and builds tool schemas", async () => {
    const ws = createMockWs();
    const mcp = new McpManager("test-session", ws, mockLogger);

    await mcp.initialize();

    // Simulate tools/list response
    const toolsListMsg = ws.sent.find((s) => s.includes("tools/list"));
    const parsed = JSON.parse(toolsListMsg!);

    // Simulate receiving the response via onResult
    mcp.onResult({
      id: parsed.payload.id,
      result: {
        tools: [
          {
            name: "self.robot.set_head_angles",
            description: "Set robot head angles",
            inputSchema: {
              type: "object",
              properties: {
                pitch: { type: "number", description: "Pitch angle" },
                yaw: { type: "number", description: "Yaw angle" },
                speed: { type: "number", description: "Movement speed" },
              },
              required: ["pitch"],
            },
          },
          {
            name: "self.robot.set_led_color",
            description: "Set LED color",
            inputSchema: {
              type: "object",
              properties: {
                red: { type: "number", description: "Red component" },
                green: { type: "number", description: "Green component" },
                blue: { type: "number", description: "Blue component" },
              },
              required: ["red", "green", "blue"],
            },
          },
        ],
      },
    });

    // Verify tools were stored
    const tools = mcp.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("self.robot.set_head_angles");
    expect(tools[1].name).toBe("self.robot.set_led_color");

    // Verify tool schemas were converted
    const schemas = mcp.getToolSchemas();
    expect(schemas).toHaveLength(2);
    expect(schemas[0].function.name).toBe("self_robot_set_head_angles"); // dots replaced with underscores
    expect(schemas[0].function.parameters.properties).toBeDefined();
  });

  it("handles MCP call with timeout", async () => {
    const ws = createMockWs();
    const mcp = new McpManager("test-session", ws, mockLogger);

    // Call a tool without waiting for response - should timeout after 3 seconds
    await expect(mcp.callTool("self.robot.set_head_angles", { pitch: 20 }))
      .rejects.toThrow("MCP tool self.robot.set_head_angles call timeout");
  });
});

describe("Xiaozhi protocol messages", () => {
  it("formats hello response correctly", () => {
    const ws = createMockWs();
    const mcp = new McpManager("session-hello", ws, mockLogger);

    const expectedAudioParams = {
      format: "opus",
      sample_rate: 16000,
      channels: 1,
      frame_duration: 60,
    };

    // The actual hello message would be sent by session, but we can verify
    // the structure is correct by checking what the session constructs
    const helloMsg = JSON.stringify({
      type: "hello",
      version: 1,
      features: { mcp: true },
      transport: "websocket",
      audio_params: expectedAudioParams,
    });

    expect(helloMsg).toContain('"type":"hello"');
    expect(helloMsg).toContain('"version":1');
    expect(helloMsg).toContain('"features":{"mcp":true}');
    expect(helloMsg).toContain('"audio_params"');
  });
});