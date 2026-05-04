/**
 * MCP Manager - JSON-RPC 2.0 client for MCP communication
 *
 * This implements the client-side MCP:
 * - Sends initialize to device
 * - Sends tools/list to discover device capabilities
 * - Calls tools on the device via tools/call
 *
 * Reference: xiaozhi-esp32/main/mcp_server.cc
 */
export class McpManager {
    connectionId;
    ws;
    log;
    callId = 0;
    pending = new Map();
    tools = [];
    toolSchemas = [];
    constructor(connectionId, ws, log) {
        this.connectionId = connectionId;
        this.ws = ws;
        this.log = log;
    }
    getTools() {
        return this.tools;
    }
    getToolSchemas() {
        return this.toolSchemas;
    }
    /**
     * Initialize MCP connection with the device
     * Sends initialize and tools/list
     */
    async initialize() {
        try {
            // Step 1: Send initialize
            await this.sendMcp({
                jsonrpc: "2.0",
                method: "initialize",
                params: {
                    protocolVersion: "2024-11-05",
                    clientInfo: { name: "openclaw-xiaozhi", version: "1.0" },
                },
                id: this.nextId(),
            });
            // Wait for device to respond
            await new Promise((resolve) => setTimeout(resolve, 300));
            // Step 2: Request tool list from device
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
                        }
                        else {
                            setTimeout(check, 100);
                        }
                    };
                    check();
                });
            }
            catch {
                this.log.warn?.(`[${this.connectionId}] MCP tools/list timeout, continuing without tools`);
            }
            this.log.info?.(`[${this.connectionId}] MCP initialized, tools: ${this.tools.map((t) => t.name).join(", ") || "none"}`);
        }
        catch (err) {
            this.log.warn?.(`[${this.connectionId}] MCP init failed: ${err}`);
        }
    }
    /**
     * Call a tool on the device
     */
    async callTool(name, args) {
        const callId = this.nextId();
        const result = await new Promise((resolve, reject) => {
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
        this.log.debug?.(`[${this.connectionId}] MCP tool ${name} result: ${JSON.stringify(result)}`);
        return result;
    }
    /**
     * Handle MCP response from device
     */
    onResult(payload) {
        if (payload.id == null)
            return;
        const callId = Number(payload.id);
        const pending = this.pending.get(callId);
        if (pending) {
            clearTimeout(pending.timeout);
            if (payload.error) {
                pending.reject(new Error(`MCP error ${payload.error.code}: ${payload.error.message}`));
            }
            else {
                pending.resolve(payload.result);
            }
            this.pending.delete(callId);
        }
        // Handle tools/list response specially
        if (payload.result && typeof payload.result === "object" && "tools" in payload.result) {
            const result = payload.result;
            if (result.tools) {
                this.tools = result.tools;
                this.toolSchemas = this.tools.map((t) => this.toOpenAiSchema(t));
            }
        }
    }
    nextId() {
        return ++this.callId;
    }
    async sendMcp(payload) {
        // Wrap in xiaozhi MCP message format
        const msg = JSON.stringify({ type: "mcp", payload });
        return new Promise((resolve, reject) => {
            this.ws.send(msg, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    toOpenAiSchema(tool) {
        const inputSchema = (tool.inputSchema ?? {});
        const properties = inputSchema.properties ?? {};
        const required = inputSchema.required ?? [];
        return {
            type: "function",
            function: {
                name: tool.name.replaceAll(".", "_"),
                description: tool.description ?? "",
                parameters: {
                    type: "object",
                    properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [
                        k,
                        { type: v.type ?? "string", description: v.description ?? "" },
                    ])),
                    required,
                },
            },
        };
    }
}
