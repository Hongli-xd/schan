/**
 * StackChan Robot Simulation Model
 *
 * This module provides a simulation of a StackChan robot's input/output
 * for testing the xiaozhi plugin with StackChan binary protocol.
 *
 * StackChan Binary Protocol:
 * - Message format: [msgType: 1 byte][dataLen: 4 bytes BE][payload: dataLen bytes]
 * - TextMessage (0x07): payload = [macAddr: 12 bytes][text data]
 * - Opus (0x01): raw Opus audio frames
 * - ControlAvatar (0x03): payload = [macAddr: 12 bytes][control data]
 * - ControlMotion (0x04): payload = [macAddr: 12 bytes][motion data]
 */
// Re-export StackChan types from protocol.ts
export { StackChanMsgType } from "../protocol.js";
import { StackChanMsgType } from "../protocol.js";
/**
 * Create a StackChan binary message
 */
export function createStackChanMessage(msgType, payload) {
    const dataLen = payload?.length ?? 0;
    const msg = Buffer.alloc(1 + 4 + dataLen);
    msg[0] = msgType;
    msg.writeUInt32BE(dataLen, 1);
    if (payload && dataLen > 0) {
        payload.copy(msg, 5);
    }
    return msg;
}
/**
 * Create a StackChan message with MAC address routing
 * For messages like TextMessage, ControlAvatar, etc.
 */
export function createStackChanRoutedMessage(msgType, mac, data) {
    const macBuffer = Buffer.from(mac.padEnd(12).slice(0, 12), "ascii");
    const payload = Buffer.concat([macBuffer, data]);
    return createStackChanMessage(msgType, payload);
}
/**
 * Parse a StackChan binary message
 */
export function parseStackChanMessage(data) {
    if (data.length < 5) {
        return null;
    }
    const msgType = data[0];
    const dataLen = data.readUInt32BE(1);
    if (data.length < 5 + dataLen) {
        return null;
    }
    const payload = data.subarray(5, 5 + dataLen);
    // Check if this is a routed message (has MAC address)
    const routedTypes = [
        StackChanMsgType.TextMessage,
        StackChanMsgType.ControlAvatar,
        StackChanMsgType.ControlMotion,
        StackChanMsgType.Jpeg,
        StackChanMsgType.OnCamera,
        StackChanMsgType.OffCamera,
        StackChanMsgType.RequestCall,
        StackChanMsgType.HangupCall,
        StackChanMsgType.OnPhoneScreen,
        StackChanMsgType.OffPhoneScreen,
    ];
    if (routedTypes.includes(msgType) && payload.length >= 12) {
        const mac = payload.subarray(0, 12).toString("ascii").trim();
        return { msgType, payload: payload.subarray(12), mac };
    }
    return { msgType, payload };
}
/**
 * Simulated StackChan Robot
 *
 * Simulates the robot side of the StackChan WebSocket connection.
 * Uses the StackChan binary protocol to communicate.
 */
export class SimulatedStackChan {
    messageHandlers = [];
    mac;
    name;
    constructor(mac = "AABBCCDDEEFF", name = "SimulatedStackChan") {
        this.mac = mac;
        this.name = name;
    }
    getMac() {
        return this.mac;
    }
    getName() {
        return this.name;
    }
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }
    /**
     * Process incoming message and return responses
     */
    receive(data) {
        const responses = [];
        const msg = parseStackChanMessage(data);
        if (!msg) {
            console.log(`[SimStackChan] Failed to parse message`);
            return responses;
        }
        console.log(`[SimStackChan] Received msgType=0x${msg.msgType.toString(16)}, mac=${msg.mac ?? "none"}`);
        switch (msg.msgType) {
            case StackChanMsgType.TextMessage: {
                const text = msg.payload.toString("utf8");
                console.log(`[SimStackChan] Text message: "${text}"`);
                break;
            }
            case StackChanMsgType.ControlAvatar: {
                console.log(`[SimStackChan] Avatar control: ${msg.payload.toString("hex")}`);
                break;
            }
            case StackChanMsgType.ControlMotion: {
                console.log(`[SimStackChan] Motion control: ${msg.payload.toString("hex")}`);
                break;
            }
            case StackChanMsgType.GetDeviceName: {
                const namePayload = Buffer.from(this.name, "utf8");
                responses.push(createStackChanMessage(StackChanMsgType.GetDeviceName, namePayload));
                console.log(`[SimStackChan] Responded with name: "${this.name}"`);
                break;
            }
            case StackChanMsgType.ping: {
                responses.push(createStackChanMessage(StackChanMsgType.pong));
                console.log(`[SimStackChan] Responded to ping`);
                break;
            }
            case StackChanMsgType.Opus: {
                console.log(`[SimStackChan] Received audio: ${msg.payload.length} bytes`);
                break;
            }
            default:
                console.log(`[SimStackChan] Unknown msgType: 0x${msg.msgType.toString(16)}`);
        }
        for (const handler of this.messageHandlers) {
            handler(msg);
        }
        return responses;
    }
    /**
     * Send text from robot (simulating speech recognition result)
     * Returns a routed TextMessage binary
     */
    sendText(text) {
        const textBuffer = Buffer.from(text, "utf8");
        return createStackChanRoutedMessage(StackChanMsgType.TextMessage, this.mac, textBuffer);
    }
    /**
     * Send audio from robot (Opus frame)
     * Returns an Opus binary message
     */
    sendAudio(audioData) {
        return createStackChanMessage(StackChanMsgType.Opus, audioData);
    }
    /**
     * Send device online notification
     */
    sendOnline() {
        const payload = Buffer.from(`Device ${this.name} is online`, "utf8");
        return createStackChanMessage(StackChanMsgType.DeviceOnline, payload);
    }
    /**
     * Send device offline notification
     */
    sendOffline() {
        const payload = Buffer.from(`Device ${this.name} is offline`, "utf8");
        return createStackChanMessage(StackChanMsgType.DeviceOffline, payload);
    }
}
/**
 * xiaozhi to StackChan Protocol Translation
 */
export class XiaozhiToStackChanTranslator {
    /**
     * Convert xiaozhi JSON message to StackChan binary message
     */
    static fromXiaozhiJson(type, data, robotMac) {
        switch (type) {
            case "tts": {
                const ttsData = data;
                if (ttsData.text) {
                    const textBuffer = Buffer.from(ttsData.text, "utf8");
                    return createStackChanRoutedMessage(StackChanMsgType.TextMessage, robotMac, textBuffer);
                }
                return null;
            }
            case "mcp": {
                const mcpData = data;
                if (mcpData.method?.startsWith("self.robot.set_led_color")) {
                    const { red = 0, green = 0, blue = 0 } = mcpData.arguments ?? {};
                    const controlData = Buffer.from([red, green, blue]);
                    return createStackChanRoutedMessage(StackChanMsgType.ControlAvatar, robotMac, controlData);
                }
                if (mcpData.method?.startsWith("self.robot.set_head_angles")) {
                    const { pitch = 0, yaw = 0, speed = 180 } = mcpData.arguments ?? {};
                    const controlData = Buffer.alloc(12);
                    controlData.writeFloatBE(pitch, 0);
                    controlData.writeFloatBE(yaw, 4);
                    controlData.writeFloatBE(speed, 8);
                    return createStackChanRoutedMessage(StackChanMsgType.ControlMotion, robotMac, controlData);
                }
                return null;
            }
            default:
                return null;
        }
    }
}
/**
 * StackChan to xiaozhi Protocol Translation
 */
export class StackChanToXiaozhiTranslator {
    /**
     * Convert StackChan binary message to xiaozhi JSON format
     */
    static toXiaozhiJson(msg) {
        switch (msg.msgType) {
            case StackChanMsgType.TextMessage: {
                const text = msg.payload.toString("utf8");
                return { type: "stt", text };
            }
            case StackChanMsgType.Opus: {
                return { type: "audio", data: msg.payload.toString("base64") };
            }
            case StackChanMsgType.DeviceOnline: {
                return { type: "iot", event: "device_online", data: msg.payload.toString("utf8") };
            }
            case StackChanMsgType.DeviceOffline: {
                return { type: "iot", event: "device_offline", data: msg.payload.toString("utf8") };
            }
            case StackChanMsgType.ControlAvatar:
            case StackChanMsgType.ControlMotion: {
                return { type: "iot", event: "control", data: msg.payload.toString("hex") };
            }
            default:
                return null;
        }
    }
}
/**
 * Run a simulation demonstrating the protocol interaction
 */
export async function runSimulation() {
    console.log("=== StackChan Robot Simulation ===\n");
    const robot = new SimulatedStackChan("AABBCCDDEEFF", "TestRobot");
    // Scenario 1: OpenClaw sends TTS response to robot
    console.log("--- Scenario 1: OpenClaw TTS Response ---\n");
    const ttsBinary = XiaozhiToStackChanTranslator.fromXiaozhiJson("tts", { text: "Hello, I am your assistant!" }, robot.getMac());
    if (ttsBinary) {
        console.log(`1. xiaozhi sends TTS binary: ${ttsBinary.toString("hex").slice(0, 50)}...`);
        const responses = robot.receive(ttsBinary);
        console.log(`2. Robot received, ${responses.length} response(s)`);
    }
    // Scenario 2: Robot sends speech recognition result to xiaozhi
    console.log("\n--- Scenario 2: Robot STT Result ---\n");
    const robotSttBinary = robot.sendText("What is the weather today?");
    console.log(`3. Robot sends STT binary: ${robotSttBinary.toString("hex").slice(0, 50)}...`);
    const parsed = parseStackChanMessage(robotSttBinary);
    if (parsed) {
        const xiaozhiJson = StackChanToXiaozhiTranslator.toXiaozhiJson(parsed);
        console.log(`4. Converted to xiaozhi JSON: ${JSON.stringify(xiaozhiJson)}`);
    }
    // Scenario 3: MCP tool call for LED control
    console.log("\n--- Scenario 3: MCP LED Control ---\n");
    const ledBinary = XiaozhiToStackChanTranslator.fromXiaozhiJson("mcp", { method: "self.robot.set_led_color", arguments: { red: 255, green: 0, blue: 128 } }, robot.getMac());
    if (ledBinary) {
        console.log(`5. xiaozhi sends LED control binary: ${ledBinary.toString("hex")}`);
        robot.receive(ledBinary);
    }
    // Scenario 4: MCP tool call for head motion
    console.log("\n--- Scenario 4: MCP Head Motion ---\n");
    const motionBinary = XiaozhiToStackChanTranslator.fromXiaozhiJson("mcp", { method: "self.robot.set_head_angles", arguments: { pitch: 20, yaw: -15, speed: 180 } }, robot.getMac());
    if (motionBinary) {
        console.log(`6. xiaozhi sends head motion binary: ${motionBinary.toString("hex")}`);
        robot.receive(motionBinary);
    }
    // Scenario 5: Ping/pong heartbeat
    console.log("\n--- Scenario 5: Heartbeat ---\n");
    const pingMsg = createStackChanMessage(StackChanMsgType.ping);
    console.log(`7. Ping: ${pingMsg.toString("hex")}`);
    const pongResponses = robot.receive(pingMsg);
    if (pongResponses.length > 0) {
        console.log(`8. Pong: ${pongResponses[0].toString("hex")}`);
    }
    console.log("\n=== Simulation Complete ===");
}
