/**
 * Xiaozhi ESP32 Firmware Simulation
 *
 * Simulates the xiaozhi-esp32 firmware behavior:
 * 1. Connects to xiaozhi WebSocket server with proper headers
 * 2. Sends hello message with device capabilities
 * 3. Handles server hello
 * 4. Processes TTS/MCP messages from server
 * 5. Sends listen(detect) when wake word is detected
 * 6. Sends audio data and receives STT results
 * 7. Simulates MCP tool responses
 *
 * Run with: bun run sim/firmware-sim.ts
 */
import WebSocket from "ws";
const SERVER_URL = process.env.XIAOZHI_SERVER_URL || "ws://localhost:8765";
const DEVICE_ID = process.env.DEVICE_ID || "AABBCCDDEEFF";
const CLIENT_ID = process.env.CLIENT_ID || "550e8400-e29b-41d4-a716-446655440000";
const DEBUG = process.env.DEBUG === "true";
function debug(...args) {
    if (DEBUG) {
        console.log("[FirmwareSim]", ...args);
    }
}
class SimulatedStackChanFirmware {
    ws = null;
    sessionId = "";
    audioParams = {
        format: "opus",
        sample_rate: 16000,
        channels: 1,
        frame_duration: 60,
    };
    connected = false;
    privateProtocolVersion = 1;
    /**
     * Connect to xiaozhi WebSocket server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`[FirmwareSim] Connecting to ${SERVER_URL}...`);
            this.ws = new WebSocket(SERVER_URL, {
                headers: {
                    "Authorization": "Bearer test-token",
                    "Protocol-Version": this.privateProtocolVersion.toString(),
                    "Device-Id": DEVICE_ID,
                    "Client-Id": CLIENT_ID,
                },
            });
            this.ws.on("open", () => {
                console.log("[FirmwareSim] WebSocket connected!");
                this.connected = true;
                this.sendHello();
            });
            this.ws.on("message", (data) => {
                this.handleMessage(data);
            });
            this.ws.on("close", (code, reason) => {
                console.log(`[FirmwareSim] Disconnected: code=${code}, reason=${reason}`);
                this.connected = false;
            });
            this.ws.on("error", (err) => {
                console.error("[FirmwareSim] WebSocket error:", err.message);
                reject(err);
            });
            // Timeout after 10 seconds
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error("Connection timeout"));
                }
                else {
                    resolve();
                }
            }, 10000);
        });
    }
    /**
     * Send initial hello message
     */
    sendHello() {
        const hello = {
            type: "hello",
            version: this.privateProtocolVersion,
            features: {
                mcp: true, // We support MCP
                aec: false,
            },
            transport: "websocket",
            audio_params: this.audioParams,
        };
        debug("Sending hello:", JSON.stringify(hello));
        this.sendJson(hello);
        // Wait for server hello before proceeding
        setTimeout(() => {
            if (!this.sessionId) {
                console.warn("[FirmwareSim] No session_id received from server");
            }
        }, 2000);
    }
    /**
     * Handle incoming message from server
     */
    handleMessage(data) {
        if (typeof data === "string") {
            this.handleTextMessage(data);
        }
        else {
            this.handleBinaryMessage(Buffer.from(data));
        }
    }
    /**
     * Handle JSON text message
     */
    handleTextMessage(raw) {
        try {
            const msg = JSON.parse(raw);
            debug("Received:", JSON.stringify(msg).slice(0, 200));
            switch (msg.type) {
                case "hello":
                    this.handleServerHello(msg);
                    break;
                case "tts":
                    this.handleTts(msg);
                    break;
                case "stt":
                    this.handleStt(msg);
                    break;
                case "llm":
                    this.handleLlm(msg);
                    break;
                case "mcp":
                    this.handleMcp(msg);
                    break;
                case "system":
                    if (msg.command === "reboot") {
                        console.log("[FirmwareSim] Server requested reboot!");
                    }
                    break;
                default:
                    debug("Unknown message type:", msg.type);
            }
        }
        catch (err) {
            console.error("[FirmwareSim] Failed to parse message:", err);
        }
    }
    /**
     * Handle binary audio message
     */
    handleBinaryMessage(data) {
        debug(`Binary message: ${data.length} bytes`);
        // Protocol v2: [version:2][type:2][reserved:2][timestamp:4][payload_size:4][payload]
        // Protocol v3: [type:1][reserved:1][payload_size:2][payload]
        if (data.length >= 2) {
            const version = data.readUInt16BE(0);
            if (version === 2) {
                const type = data.readUInt16BE(2);
                const timestamp = data.readUInt32BE(8);
                const payloadSize = data.readUInt32BE(12);
                debug(`Protocol v2: type=${type}, timestamp=${timestamp}, size=${payloadSize}`);
            }
            else if (data[0] === 3) {
                const payloadSize = data.readUInt16BE(2);
                debug(`Protocol v3: size=${payloadSize}`);
            }
        }
    }
    /**
     * Handle server hello response
     */
    handleServerHello(msg) {
        console.log("[FirmwareSim] Received server hello!");
        console.log(`  session_id: ${msg.session_id}`);
        console.log(`  transport: ${msg.transport}`);
        if (msg.audio_params) {
            this.audioParams = msg.audio_params;
            console.log(`  audio_params: ${JSON.stringify(msg.audio_params)}`);
        }
        this.sessionId = msg.session_id;
        console.log("[FirmwareSim] Handshake complete!");
        // Start the interaction loop
        setTimeout(() => this.runInteractionDemo(), 1000);
    }
    /**
     * Handle TTS message from server
     */
    handleTts(msg) {
        switch (msg.state) {
            case "start":
                console.log("[FirmwareSim] TTS: started");
                break;
            case "sentence_start":
                console.log(`[FirmwareSim] TTS: "${msg.text || ""}"`);
                break;
            case "sentence_end":
                console.log("[FirmwareSim] TTS: sentence ended");
                break;
            case "stop":
                console.log("[FirmwareSim] TTS: stopped");
                break;
        }
    }
    /**
     * Handle STT result from server (echo back)
     */
    handleStt(msg) {
        console.log(`[FirmwareSim] STT result: "${msg.text}"`);
    }
    /**
     * Handle LLM emotion message
     */
    handleLlm(msg) {
        console.log(`[FirmwareSim] LLM emotion: ${msg.emotion || "none"}`);
        if (msg.text) {
            console.log(`[FirmwareSim] LLM text: "${msg.text}"`);
        }
    }
    /**
     * Handle MCP JSON-RPC message
     */
    handleMcp(msg) {
        const { payload } = msg;
        debug("MCP payload:", JSON.stringify(payload));
        if (payload.id != null) {
            // This is a request, need to respond
            this.handleMcpRequest(payload);
        }
        else if (payload.result || payload.error) {
            // This is a response (for our calls)
            debug("MCP response:", JSON.stringify(payload.result || payload.error));
        }
    }
    /**
     * Handle MCP request from server
     */
    handleMcpRequest(payload) {
        const { method, id } = payload;
        switch (method) {
            case "initialize": {
                console.log("[FirmwareSim] MCP: initialize request");
                this.sendMcpResponse({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        protocolVersion: "2024-11-05",
                        serverInfo: { name: "xiaozhi-firmware-sim", version: "1.0" },
                        capabilities: { tools: { listChanged: false } },
                    },
                });
                break;
            }
            case "tools/list": {
                console.log("[FirmwareSim] MCP: tools/list request");
                this.sendMcpResponse({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        tools: [
                            {
                                name: "self.robot.get_head_angles",
                                description: "Returns current yaw/pitch",
                                inputSchema: { type: "object", properties: {}, required: [] },
                            },
                            {
                                name: "self.robot.set_head_angles",
                                description: "Set head position",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        pitch: { type: "number" },
                                        yaw: { type: "number" },
                                        speed: { type: "number" },
                                    },
                                    required: [],
                                },
                            },
                            {
                                name: "self.robot.set_led_color",
                                description: "Set LED color",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        red: { type: "number" },
                                        green: { type: "number" },
                                        blue: { type: "number" },
                                    },
                                    required: ["red", "green", "blue"],
                                },
                            },
                        ],
                    },
                });
                break;
            }
            case "tools/call": {
                const params = payload.params;
                console.log(`[FirmwareSim] MCP: tools/call - ${params?.name}`);
                if (params?.arguments) {
                    console.log(`  arguments: ${JSON.stringify(params.arguments)}`);
                }
                // Simulate robot action
                this.simulateRobotAction(params?.name || "", params?.arguments || {});
                this.sendMcpResponse({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [{ type: "text", text: "ok" }],
                        isError: false,
                    },
                });
                break;
            }
            default:
                console.log(`[FirmwareSim] MCP: unknown method - ${method}`);
                this.sendMcpResponse({
                    jsonrpc: "2.0",
                    id,
                    error: { code: -32601, message: `Method not found: ${method}` },
                });
        }
    }
    /**
     * Simulate robot performing an action
     */
    simulateRobotAction(name, args) {
        if (name === "self.robot.set_led_color") {
            const { red, green, blue } = args;
            console.log(`[FirmwareSim] Robot LED: rgb(${red}, ${green}, ${blue})`);
        }
        else if (name === "self.robot.set_head_angles") {
            const { pitch, yaw, speed } = args;
            console.log(`[FirmwareSim] Robot head: pitch=${pitch}, yaw=${yaw}, speed=${speed}`);
        }
        else if (name === "self.robot.get_head_angles") {
            console.log(`[FirmwareSim] Robot head angles: yaw=0, pitch=0`);
        }
    }
    /**
     * Send MCP response
     */
    sendMcpResponse(response) {
        this.sendJson({
            type: "mcp",
            session_id: this.sessionId,
            payload: response,
        });
    }
    /**
     * Demo interaction loop
     */
    async runInteractionDemo() {
        console.log("\n=== Starting Interaction Demo ===\n");
        // Wait a bit
        await this.delay(500);
        // Scenario 1: Send listen(detect) - simulating wake word detection
        console.log("[FirmwareSim] Simulating wake word detection...");
        this.sendJson({
            type: "listen",
            state: "detect",
            text: "小智",
        });
        await this.delay(300);
        // Scenario 2: Send some simulated audio (would be Opus frames in real firmware)
        console.log("[FirmwareSim] Sending simulated audio frames...");
        this.sendBinary(this.generateFakeOpusFrame());
        await this.delay(300);
        // Scenario 3: Send listen(stop) - simulating end of speech
        console.log("[FirmwareSim] Ending speech...");
        this.sendJson({
            type: "listen",
            state: "stop",
        });
        // Wait for server to process
        await this.delay(2000);
        // Scenario 4: Another interaction
        console.log("\n[FirmwareSim] Starting second interaction...");
        this.sendJson({
            type: "listen",
            state: "detect",
            text: "小智",
        });
        await this.delay(300);
        this.sendBinary(this.generateFakeOpusFrame());
        await this.delay(300);
        this.sendJson({
            type: "listen",
            state: "stop",
        });
        await this.delay(2000);
        console.log("\n=== Demo Complete ===");
        console.log("[FirmwareSim] Closing connection...");
        this.ws?.close();
    }
    /**
     * Generate fake Opus frame for testing
     */
    generateFakeOpusFrame() {
        // In real firmware this would be actual Opus audio
        // For simulation, just send some bytes
        return Buffer.alloc(160); // 60ms @ 16kHz mono = 960 samples, ~20ms of Opus
    }
    /**
     * Send JSON message
     */
    sendJson(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    /**
     * Send binary message
     */
    sendBinary(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data, { binary: true });
        }
    }
    delay(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
}
/**
 * Main entry point
 */
async function main() {
    console.log("=== Xiaozhi ESP32 Firmware Simulation ===\n");
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Device ID: ${DEVICE_ID}`);
    console.log(`Client ID: ${CLIENT_ID}`);
    console.log();
    const firmware = new SimulatedStackChanFirmware();
    try {
        await firmware.connect();
    }
    catch (err) {
        console.error("\n[FirmwareSim] Failed to connect:", err);
        console.log("\nMake sure the xiaozhi plugin is running:");
        console.log(`  1. Start OpenClaw gateway with xiaozhi plugin enabled`);
        console.log(`  2. The plugin should be listening on ws://localhost:8765`);
        process.exit(1);
    }
}
main();
