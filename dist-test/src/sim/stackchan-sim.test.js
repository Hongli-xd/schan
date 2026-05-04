/**
 * StackChan Simulation Tests
 */
import { describe, it, expect } from "vitest";
import { SimulatedStackChan, createStackChanMessage, createStackChanRoutedMessage, parseStackChanMessage, StackChanMsgType, XiaozhiToStackChanTranslator, StackChanToXiaozhiTranslator, } from "./stackchan-sim.js";
describe("StackChan Message Creation", () => {
    it("should create a valid binary message with payload", () => {
        const payload = Buffer.from("Hello", "utf8");
        const msg = createStackChanMessage(StackChanMsgType.TextMessage, payload);
        expect(msg[0]).toBe(StackChanMsgType.TextMessage);
        expect(msg.readUInt32BE(1)).toBe(5);
        expect(msg.subarray(5).toString("utf8")).toBe("Hello");
    });
    it("should create a message with empty payload", () => {
        const msg = createStackChanMessage(StackChanMsgType.ping);
        expect(msg[0]).toBe(StackChanMsgType.ping);
        expect(msg.readUInt32BE(1)).toBe(0);
        expect(msg.length).toBe(5);
    });
    it("should create a routed message with MAC address", () => {
        const mac = "AABBCCDDEEFF";
        const data = Buffer.from("Hello", "utf8");
        const msg = createStackChanRoutedMessage(StackChanMsgType.TextMessage, mac, data);
        expect(msg[0]).toBe(StackChanMsgType.TextMessage);
        const payloadLen = msg.readUInt32BE(1);
        expect(payloadLen).toBe(12 + 5); // MAC (12) + data (5)
        const payload = msg.subarray(5);
        expect(payload.subarray(0, 12).toString("ascii")).toBe(mac);
        expect(payload.subarray(12).toString("utf8")).toBe("Hello");
    });
});
describe("StackChan Message Parsing", () => {
    it("should parse a non-routed message", () => {
        const payload = Buffer.from("Test message", "utf8");
        const original = createStackChanMessage(StackChanMsgType.Opus, payload);
        const parsed = parseStackChanMessage(original);
        expect(parsed).not.toBeNull();
        expect(parsed.msgType).toBe(StackChanMsgType.Opus);
        expect(parsed.payload.toString("utf8")).toBe("Test message");
        expect(parsed.mac).toBeUndefined();
    });
    it("should parse a routed message and extract MAC", () => {
        const mac = "AABBCCDDEEFF";
        const data = Buffer.from("Hello Robot", "utf8");
        const original = createStackChanRoutedMessage(StackChanMsgType.TextMessage, mac, data);
        const parsed = parseStackChanMessage(original);
        expect(parsed).not.toBeNull();
        expect(parsed.msgType).toBe(StackChanMsgType.TextMessage);
        expect(parsed.mac).toBe(mac);
        expect(parsed.payload.toString("utf8")).toBe("Hello Robot");
    });
    it("should return null for incomplete message", () => {
        const incomplete = Buffer.from([0x07, 0x00, 0x00, 0x00, 0x05, 0x48]);
        expect(parseStackChanMessage(incomplete)).toBeNull();
    });
    it("should return null for message too short", () => {
        expect(parseStackChanMessage(Buffer.from([0x07]))).toBeNull();
    });
});
describe("SimulatedStackChan", () => {
    it("should return correct MAC and name", () => {
        const robot = new SimulatedStackChan("112233445566", "TestBot");
        expect(robot.getMac()).toBe("112233445566");
        expect(robot.getName()).toBe("TestBot");
    });
    it("should send text message with correct MAC", () => {
        const robot = new SimulatedStackChan("AABBCCDDEEFF");
        const msg = robot.sendText("Hello");
        const parsed = parseStackChanMessage(msg);
        expect(parsed).not.toBeNull();
        expect(parsed.mac).toBe("AABBCCDDEEFF");
        expect(parsed.payload.toString("utf8")).toBe("Hello");
    });
    it("should receive and process text message", () => {
        const robot = new SimulatedStackChan();
        const text = "Hello robot";
        const msg = robot.sendText(text);
        const responses = robot.receive(msg);
        // Text messages don't generate responses
        expect(responses).toHaveLength(0);
    });
    it("should respond to ping with pong", () => {
        const robot = new SimulatedStackChan();
        const pingMsg = createStackChanMessage(StackChanMsgType.ping);
        const responses = robot.receive(pingMsg);
        expect(responses).toHaveLength(1);
        expect(responses[0][0]).toBe(StackChanMsgType.pong);
    });
    it("should respond to GetDeviceName with name", () => {
        const robot = new SimulatedStackChan("AABBCCDDEEFF", "MyRobot");
        const getNameMsg = createStackChanMessage(StackChanMsgType.GetDeviceName);
        const responses = robot.receive(getNameMsg);
        expect(responses).toHaveLength(1);
        const parsed = parseStackChanMessage(responses[0]);
        expect(parsed.msgType).toBe(StackChanMsgType.GetDeviceName);
        expect(parsed.payload.toString("utf8")).toBe("MyRobot");
    });
    it("should handle control messages without response", () => {
        const robot = new SimulatedStackChan();
        const mac = robot.getMac();
        const controlData = Buffer.from([255, 0, 0]); // Red LED
        const controlMsg = createStackChanRoutedMessage(StackChanMsgType.ControlAvatar, mac, controlData);
        const responses = robot.receive(controlMsg);
        expect(responses).toHaveLength(0);
    });
});
describe("XiaozhiToStackChanTranslator", () => {
    it("should convert xiaozhi TTS to StackChan TextMessage", () => {
        const robotMac = "AABBCCDDEEFF";
        const binary = XiaozhiToStackChanTranslator.fromXiaozhiJson("tts", { text: "Hello world" }, robotMac);
        expect(binary).not.toBeNull();
        const parsed = parseStackChanMessage(binary);
        expect(parsed.msgType).toBe(StackChanMsgType.TextMessage);
        expect(parsed.mac).toBe(robotMac);
        expect(parsed.payload.toString("utf8")).toBe("Hello world");
    });
    it("should convert LED color MCP call to ControlAvatar", () => {
        const robotMac = "AABBCCDDEEFF";
        const binary = XiaozhiToStackChanTranslator.fromXiaozhiJson("mcp", { method: "self.robot.set_led_color", arguments: { red: 255, green: 128, blue: 64 } }, robotMac);
        expect(binary).not.toBeNull();
        const parsed = parseStackChanMessage(binary);
        expect(parsed.msgType).toBe(StackChanMsgType.ControlAvatar);
        expect(parsed.payload[0]).toBe(255);
        expect(parsed.payload[1]).toBe(128);
        expect(parsed.payload[2]).toBe(64);
    });
    it("should convert head angles MCP call to ControlMotion", () => {
        const robotMac = "AABBCCDDEEFF";
        const binary = XiaozhiToStackChanTranslator.fromXiaozhiJson("mcp", { method: "self.robot.set_head_angles", arguments: { pitch: 20, yaw: -15, speed: 180 } }, robotMac);
        expect(binary).not.toBeNull();
        const parsed = parseStackChanMessage(binary);
        expect(parsed.msgType).toBe(StackChanMsgType.ControlMotion);
    });
    it("should return null for unknown xiaozhi type", () => {
        const result = XiaozhiToStackChanTranslator.fromXiaozhiJson("unknown", {}, "AABBCCDDEEFF");
        expect(result).toBeNull();
    });
});
describe("StackChanToXiaozhiTranslator", () => {
    it("should convert StackChan TextMessage to xiaozhi stt", () => {
        const mac = "AABBCCDDEEFF";
        const textData = Buffer.from("What is the weather?", "utf8");
        const msg = createStackChanRoutedMessage(StackChanMsgType.TextMessage, mac, textData);
        const parsed = parseStackChanMessage(msg);
        const xiaozhiJson = StackChanToXiaozhiTranslator.toXiaozhiJson(parsed);
        expect(xiaozhiJson).toEqual({ type: "stt", text: "What is the weather?" });
    });
    it("should convert StackChan Opus to xiaozhi audio", () => {
        const audioData = Buffer.from("fake-audio-data");
        const msg = createStackChanMessage(StackChanMsgType.Opus, audioData);
        const parsed = parseStackChanMessage(msg);
        const xiaozhiJson = StackChanToXiaozhiTranslator.toXiaozhiJson(parsed);
        expect(xiaozhiJson).toEqual({
            type: "audio",
            data: audioData.toString("base64"),
        });
    });
    it("should convert StackChan DeviceOnline to xiaozhi iot", () => {
        const msg = createStackChanMessage(StackChanMsgType.DeviceOnline, Buffer.from("Robot is online"));
        const parsed = parseStackChanMessage(msg);
        const xiaozhiJson = StackChanToXiaozhiTranslator.toXiaozhiJson(parsed);
        expect(xiaozhiJson).toEqual({
            type: "iot",
            event: "device_online",
            data: "Robot is online",
        });
    });
});
