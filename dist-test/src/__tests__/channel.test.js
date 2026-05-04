/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { xiaozhiPlugin } from "../channel.js";
describe("xiaozhiPlugin", () => {
    it("has correct plugin id", () => {
        expect(xiaozhiPlugin.id).toBe("xiaozhi");
    });
    it("has correct meta information", () => {
        expect(xiaozhiPlugin.meta.id).toBe("xiaozhi");
        expect(xiaozhiPlugin.meta.name).toBe("Xiaozhi");
        expect(xiaozhiPlugin.meta.description).toBe("Xiaozhi Protocol for ESP32 robots - OpenClaw replacement for xiaozhi cloud");
    });
    it("has capabilities defined", () => {
        expect(xiaozhiPlugin.capabilities).toEqual({
            chatTypes: ["direct"],
            media: false,
            reactions: false,
        });
    });
    it("has config schema defined", () => {
        expect(xiaozhiPlugin.configSchema).toBeDefined();
        expect(xiaozhiPlugin.configSchema?.properties).toBeDefined();
        expect(xiaozhiPlugin.configSchema?.properties.port).toBeDefined();
        expect(xiaozhiPlugin.configSchema?.properties.asr).toBeDefined();
        expect(xiaozhiPlugin.configSchema?.properties.tts).toBeDefined();
    });
    it("has default account configuration", () => {
        const accountIds = xiaozhiPlugin.config.listAccountIds({});
        expect(accountIds).toEqual(["default"]);
        const account = xiaozhiPlugin.config.resolveAccount({}, "default");
        expect(account).toEqual({
            accountId: "default",
            configured: true,
            enabled: true,
        });
        const defaultAccountId = xiaozhiPlugin.config.defaultAccountId({});
        expect(defaultAccountId).toBe("default");
    });
    it("has status adapter with working probe", async () => {
        const probeResult = await xiaozhiPlugin.status.probeAccount({
            account: { accountId: "default", configured: true, enabled: true },
            timeoutMs: 5000,
            cfg: {},
        });
        expect(probeResult.ok).toBe(true);
    });
    it("has outbound adapter", () => {
        expect(xiaozhiPlugin.outbound).toBeDefined();
        expect(xiaozhiPlugin.outbound?.deliveryMode).toBe("direct");
        expect(xiaozhiPlugin.outbound?.sendText).toBeDefined();
    });
    it("sendText returns unsupported for ESP32", async () => {
        const result = await xiaozhiPlugin.outbound.sendText({
            cfg: {},
            to: "esp32",
            text: "hello",
        });
        expect(result).toEqual({ channel: "xiaozhi", messageId: "unsupported" });
    });
});
describe("xiaozhiConfigSchema", () => {
    it("has correct structure", () => {
        const schema = xiaozhiPlugin.configSchema;
        expect(schema.type).toBe("object");
        expect(schema.properties.port).toEqual({ type: "number", default: 8765 });
        expect(schema.properties.asr.type).toBe("object");
        expect(schema.properties.tts.type).toBe("object");
        expect(schema.additionalProperties).toBe(false);
    });
});
describe("OpenClawReplyHandler", () => {
    it("action parsing works correctly", () => {
        function parseActionJson(text) {
            const match = text.match(/^\s*\{[^}]+\}\s*/);
            if (match) {
                try {
                    const action = JSON.parse(match[0]);
                    return { action, remainingText: text.slice(match[0].length) };
                }
                catch {
                    // Not valid JSON
                }
            }
            return { action: null, remainingText: text };
        }
        // Test with valid action
        const result1 = parseActionJson('{"act":"nod","emo":"joy","spd":180}你好呀');
        expect(result1.action).toEqual({ act: "nod", emo: "joy", spd: 180 });
        expect(result1.remainingText).toBe("你好呀");
        // Test without action
        const result2 = parseActionJson("没有动作前缀的文本");
        expect(result2.action).toBeNull();
        expect(result2.remainingText).toBe("没有动作前缀的文本");
    });
    it("emotion to LED mapping is defined", () => {
        const EMOTION_TO_LED = {
            joy: [80, 80, 0],
            happy: [60, 80, 0],
            sad: [0, 0, 80],
            angry: [120, 0, 0],
            surprised: [80, 40, 80],
            thinking: [0, 40, 80],
            neutral: [0, 0, 0],
            speaking: [0, 60, 40],
        };
        expect(EMOTION_TO_LED["joy"]).toEqual([80, 80, 0]);
        expect(EMOTION_TO_LED["sad"]).toEqual([0, 0, 80]);
        expect(EMOTION_TO_LED["neutral"]).toEqual([0, 0, 0]);
        expect(Object.keys(EMOTION_TO_LED)).toHaveLength(8);
    });
    it("action map is defined for all standard actions", () => {
        const ACTION_MAP = {
            nod: [
                { name: "self.robot.set_head_angles", arguments: { pitch: 20, speed: 180 } },
                ["sleep", 0.35],
                { name: "self.robot.set_head_angles", arguments: { pitch: 0, speed: 180 } },
            ],
            shake: [
                { name: "self.robot.set_head_angles", arguments: { yaw: 25, speed: 200 } },
                ["sleep", 0.25],
                { name: "self.robot.set_head_angles", arguments: { yaw: -25, speed: 200 } },
                ["sleep", 0.25],
                { name: "self.robot.set_head_angles", arguments: { yaw: 0, speed: 200 } },
            ],
            look_left: [{ name: "self.robot.set_head_angles", arguments: { yaw: -35, speed: 160 } }],
            look_right: [{ name: "self.robot.set_head_angles", arguments: { yaw: 35, speed: 160 } }],
            look_up: [{ name: "self.robot.set_head_angles", arguments: { pitch: 30, speed: 160 } }],
            look_down: [{ name: "self.robot.set_head_angles", arguments: { pitch: -10, speed: 160 } }],
            idle: [],
        };
        expect(ACTION_MAP["nod"]).toHaveLength(3);
        expect(ACTION_MAP["shake"]).toHaveLength(5);
        expect(ACTION_MAP["look_left"]).toHaveLength(1);
        expect(ACTION_MAP["idle"]).toHaveLength(0);
        expect(Object.keys(ACTION_MAP)).toHaveLength(7);
    });
});
