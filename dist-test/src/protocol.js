/**
 * Xiaozhi Protocol Types
 * Complete protocol definitions based on xiaozhi-esp32 firmware
 *
 * Reference: xiaozhi-esp32/main/protocols/websocket_protocol.cc
 * Reference: xiaozhi-esp32/main/mcp_server.cc
 * Reference: xiaozhi-esp32/main/application.cc
 */
// =============================================================================
// Binary Protocol (WebSocket binary frames)
// =============================================================================
// Binary protocol versions
export var BinaryProtocolVersion;
(function (BinaryProtocolVersion) {
    BinaryProtocolVersion[BinaryProtocolVersion["V1"] = 1] = "V1";
    BinaryProtocolVersion[BinaryProtocolVersion["V2"] = 2] = "V2";
    BinaryProtocolVersion[BinaryProtocolVersion["V3"] = 3] = "V3";
})(BinaryProtocolVersion || (BinaryProtocolVersion = {}));
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
        description: "Adjust head position. GUIDELINES: " +
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
        description: "Set the color of the robot's INTERNAL onboard LED. " +
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
];
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
};
