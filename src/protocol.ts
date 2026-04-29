/**
 * Xiaozhi Protocol Types
 * Complete protocol definitions based on xiaozhi-esp32 firmware
 *
 * Reference: xiaozhi-esp32/main/protocols/websocket_protocol.cc
 * Reference: xiaozhi-esp32/main/mcp_server.cc
 * Reference: xiaozhi-esp32/main/application.cc
 */

// =============================================================================
// WebSocket Headers (from xiaozhi-esp32)
// =============================================================================

export interface XiaozhiWebSocketHeaders {
  authorization?: string;  // "Bearer <token>"
  protocolVersion?: string;
  deviceId?: string;      // MAC address
  clientId?: string;      // UUID
}

// =============================================================================
// JSON Messages (WebSocket text frames)
// =============================================================================

// Server hello response
export interface XiaozhiServerHello {
  type: "hello";
  transport: "websocket";
  session_id: string;
  audio_params?: {
    format: "opus";
    sample_rate: number;
    channels: number;
    frame_duration: number;
  };
}

// Device hello message
export interface XiaozhiClientHello {
  type: "hello";
  version?: number;
  features?: {
    mcp?: boolean;
    aec?: boolean;
  };
  transport?: "websocket";
  audio_params?: {
    format: "opus";
    sample_rate: number;
    channels: number;
    frame_duration: number;
  };
}

// Listen state change (device → server)
export interface XiaozhiListenMessage {
  type: "listen";
  state: "detect" | "stop";
  text?: string;  // Wake word text when state is "detect"
}

// Speech recognition result (server → device)
export interface XiaozhiSttMessage {
  type: "stt";
  text: string;
}

// TTS control (server → device)
export interface XiaozhiTtsMessage {
  type: "tts";
  state: "start" | "stop" | "sentence_start" | "sentence_end";
  text?: string;
}

// Emotion display (server → device)
export interface XiaozhiLlmMessage {
  type: "llm";
  emotion?: string;  // e.g., "happy", "thinking", "surprised"
  text?: string;
}

// MCP JSON-RPC wrapper
export interface XiaozhiMcpMessage {
  type: "mcp";
  session_id?: string;
  payload: McpJsonRpcMessage;
}

// System command (server → device)
export interface XiaozhiSystemMessage {
  type: "system";
  command: "reboot";
}

// Alert display (server → device)
export interface XiaozhiAlertMessage {
  type: "alert";
  status?: string;
  message: string;
  emotion?: string;
  sound?: string;
}

// Custom message (server → device)
export interface XiaozhiCustomMessage {
  type: "custom";
  [key: string]: unknown;
}

// Abort current operation (device → server)
export interface XiaozhiAbortMessage {
  type: "abort";
}

export type XiaozhiJsonMessage =
  | XiaozhiServerHello
  | XiaozhiClientHello
  | XiaozhiListenMessage
  | XiaozhiSttMessage
  | XiaozhiTtsMessage
  | XiaozhiLlmMessage
  | XiaozhiMcpMessage
  | XiaozhiSystemMessage
  | XiaozhiAlertMessage
  | XiaozhiCustomMessage
  | XiaozhiAbortMessage;

// =============================================================================
// Binary Protocol (WebSocket binary frames)
// =============================================================================

// Binary protocol versions
export enum BinaryProtocolVersion {
  V1 = 1,  // Raw Opus frames
  V2 = 2,  // BinaryProtocol2 with timestamp
  V3 = 3,  // BinaryProtocol3 lightweight
}

// Version 2: With timestamp for server-side AEC
export interface BinaryProtocol2 {
  version: number;      // = 2
  type: number;         // 0=OPUS, 1=JSON
  reserved: number;
  timestamp: number;     // milliseconds
  payload_size: number;
  payload: Buffer;
}

// Version 3: Lightweight header
export interface BinaryProtocol3 {
  type: number;
  reserved: number;
  payload_size: number;
  payload: Buffer;
}

// =============================================================================
// MCP JSON-RPC 2.0 Messages
// =============================================================================

export interface McpJsonRpcMessage {
  jsonrpc: "2.0";
  method?: string;
  params?: Record<string, unknown>;
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpInitializeParams {
  protocolVersion: string;
  clientInfo: { name: string; version: string };
}

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: {
    tools?: { listChanged?: boolean };
  };
}

export interface McpToolsListParams {
  withUserTools?: boolean;
}

export interface McpToolsListResponse {
  tools: McpTool[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, McpToolProperty>;
    required?: string[];
  };
}

export interface McpToolProperty {
  type: "string" | "number" | "boolean" | "integer";
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export interface McpToolsCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolsCallResult {
  content: Array<{ type: "text"; text?: string }>;
  isError?: boolean;
}

// =============================================================================
// MCP Tools from StackChan (hal_mcp.cpp)
// =============================================================================

export const STACKCHAN_MCP_TOOLS = [
  {
    name: "self.robot.get_head_angles",
    description: "Returns current yaw/pitch in degrees. Neutral position is {yaw:0, pitch:0}.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "self.robot.set_head_angles",
    description:
      "Adjust head position. GUIDELINES: " +
      "1. For natural interaction, stay within +/- 45 degrees. " +
      "2. Only use values > 70 if the user explicitly asks to look far away/behind. " +
      "3. Max ranges: Yaw(-128 to 128), Pitch(0 to 90). Speed(100-1000, 150 is natural).",
    inputSchema: {
      type: "object",
      properties: {
        yaw: { type: "number", description: "Horizontal angle (-128 to 128)" },
        pitch: { type: "number", description: "Vertical angle (0 to 90)" },
        speed: { type: "number", description: "Movement speed (100-1000, default 150)" },
      },
      required: [],
    },
  },
  {
    name: "self.robot.set_led_color",
    description:
      "Set the color of the robot's INTERNAL onboard LED. " +
      "Values: 0-168 (safe range). Red=168,0,0; Green=0,168,0; Blue=0,0,168; White=100,100,100; Off=0,0,0.",
    inputSchema: {
      type: "object",
      properties: {
        red: { type: "number", minimum: 0, maximum: 168 },
        green: { type: "number", minimum: 0, maximum: 168 },
        blue: { type: "number", minimum: 0, maximum: 168 },
      },
      required: ["red", "green", "blue"],
    },
  },
  {
    name: "self.robot.create_reminder",
    description: "Create a reminder. Duration is in seconds. Message is what to say when time is up. Set repeat to true to repeat.",
    inputSchema: {
      type: "object",
      properties: {
        duration_seconds: { type: "number", minimum: 1, maximum: 86400 },
        message: { type: "string" },
        repeat: { type: "boolean" },
      },
      required: ["duration_seconds", "message"],
    },
  },
  {
    name: "self.robot.get_reminders",
    description: "Get list of active reminders.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "self.robot.stop_reminder",
    description: "Stop a reminder by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
] as const;

// =============================================================================
// Audio Parameters
// =============================================================================

export interface AudioParams {
  format: "opus";
  sample_rate: 16000;
  channels: 1;
  frame_duration: 60;
}

// =============================================================================
// StackChan Binary Protocol (for backward compatibility)
// =============================================================================

export const StackChanMsgType = {
  Opus: 0x01,
  Jpeg: 0x02,
  ControlAvatar: 0x03,
  ControlMotion: 0x04,
  OnCamera: 0x05,
  OffCamera: 0x06,
  TextMessage: 0x07,
  RequestCall: 0x09,
  RefuseCall: 0x0A,
  AgreeCall: 0x0B,
  HangupCall: 0x0C,
  UpdateDeviceName: 0x0D,
  GetDeviceName: 0x0E,
  inCall: 0x0F,
  ping: 0x10,
  pong: 0x11,
  OnPhoneScreen: 0x12,
  OffPhoneScreen: 0x13,
  Dance: 0x14,
  GetAvatarPosture: 0x15,
  DeviceOffline: 0x16,
  DeviceOnline: 0x17,
} as const;

export interface StackChanMessage {
  msgType: number;
  payload: Buffer;
  mac?: string;
}
