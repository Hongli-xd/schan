/**
 * Xiaozhi Protocol Types
 * 小智协议的消息类型定义
 */

export interface XiaozhiHelloMessage {
  type: "hello";
  version?: number;
  features?: { mcp?: boolean };
  transport?: "websocket";
  audio_params?: {
    format: "opus";
    sample_rate: number;
    channels: number;
    frame_duration: number;
  };
}

export interface XiaozhiListenMessage {
  type: "listen";
  state: "detect" | "stop";
  text?: string;
}

export interface XiaozhiSttMessage {
  type: "stt";
  text: string;
}

export interface XiaozhiTtsMessage {
  type: "tts";
  state: "start" | "stop" | "sentence_start" | "sentence_end";
  text?: string;
}

export interface XiaozhiMcpMessage {
  type: "mcp";
  payload: McpJsonRpcMessage;
}

export interface XiaozhiIotMessage {
  type: "iot";
  [key: string]: unknown;
}

export type XiaozhiJsonMessage =
  | XiaozhiHelloMessage
  | XiaozhiListenMessage
  | XiaozhiSttMessage
  | XiaozhiTtsMessage
  | XiaozhiMcpMessage
  | XiaozhiIotMessage;

// MCP JSON-RPC 2.0 messages
export interface McpJsonRpcMessage {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: number | string;
}

export interface McpInitializeParams {
  protocolVersion: string;
  clientInfo: { name: string; version: string };
}

export interface McpToolsListResponse {
  tools: McpTool[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface McpToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// Audio frame types
export interface AudioParams {
  format: "opus";
  sample_rate: 16000;
  channels: 1;
  frame_duration: 60;
}