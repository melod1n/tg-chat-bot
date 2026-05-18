import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import type {BoundaryValue} from "../../common/boundary-types.js";
import {toolsLogger} from "../tools/tool-logger.js";
import type {McpServerConfig} from "./mcp-config.js";

const logger = toolsLogger.child("mcp");
const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type McpToolDefinition = {
    name: string;
    description?: string;
    inputSchema?: BoundaryValue;
};

type JsonRpcRequest = {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: BoundaryValue;
};

type JsonRpcNotification = {
    jsonrpc: "2.0";
    method: string;
    params?: BoundaryValue;
};

type JsonRpcResponse = {
    jsonrpc?: "2.0";
    id?: BoundaryValue;
    result?: BoundaryValue;
    error?: {
        code?: number;
        message?: string;
        data?: BoundaryValue;
    };
};

interface JsonRpcTransport {
    request(method: string, params?: BoundaryValue): Promise<BoundaryValue>;
    notify(method: string, params?: BoundaryValue): Promise<void>;
    close(): Promise<void>;
}

function isRecord(value: BoundaryValue): value is Record<string, BoundaryValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJsonRpcResponse(value: BoundaryValue): JsonRpcResponse | undefined {
    if (!isRecord(value)) return undefined;
    if (value.jsonrpc !== undefined && value.jsonrpc !== "2.0") return undefined;
    return value as JsonRpcResponse;
}

function extractJsonRpcResult(response: BoundaryValue, expectedId?: number): BoundaryValue {
    const parsed = toJsonRpcResponse(response);
    if (!parsed) {
        throw new Error("Invalid JSON-RPC response from MCP server.");
    }

    if (parsed.error) {
        throw new Error(parsed.error.message || "MCP server returned an error.");
    }

    if (expectedId !== undefined && parsed.id !== undefined && parsed.id !== expectedId) {
        throw new Error(`Unexpected JSON-RPC response id from MCP server. Expected ${expectedId}, got ${String(parsed.id)}.`);
    }

    return parsed.result ?? {};
}

function parseSsePayload(text: string): BoundaryValue[] {
    const events: string[] = [];
    let current: string[] = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trimEnd();

        if (!line) {
            if (current.length) {
                events.push(current.join("\n"));
                current = [];
            }
            continue;
        }

        if (line.startsWith("data:")) {
            current.push(line.slice(5).replace(/^ /, ""));
        }
    }

    if (current.length) {
        events.push(current.join("\n"));
    }

    return events.map(event => {
        try {
            return JSON.parse(event) as BoundaryValue;
        } catch {
            return undefined;
        }
    }).filter((event): event is BoundaryValue => event !== undefined);
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

class StdioJsonRpcTransport implements JsonRpcTransport {
    private readonly process: ChildProcessWithoutNullStreams;
    private readonly pending = new Map<number, {resolve: (value: BoundaryValue) => void; reject: (error: Error) => void;}>();
    private buffer = "";
    private nextId = 1;

    constructor(private readonly config: McpServerConfig) {
        if (!config.command) {
            throw new Error(`MCP stdio server '${config.name}' is missing command.`);
        }

        this.process = spawn(config.command, config.args ?? [], {
            cwd: config.cwd,
            env: {
                ...process.env,
                ...config.env,
            },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });

        this.process.stdout.on("data", chunk => this.handleStdout(chunk));
        this.process.stderr.on("data", chunk => {
            const text = chunk.toString("utf8").trim();
            if (text) logger.debug("stdio.stderr", {server: config.name, text});
        });
        this.process.on("error", error => this.failAll(error));
        this.process.on("exit", code => this.failAll(new Error(`MCP stdio server '${config.name}' exited with code ${code ?? "unknown"}.`)));
    }

    private handleStdout(chunk: Buffer): void {
        this.buffer += chunk.toString("utf8");

        let newlineIndex = this.buffer.indexOf("\n");
        while (newlineIndex !== -1) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            newlineIndex = this.buffer.indexOf("\n");

            if (!line) continue;

            try {
                const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
                if ("id" in message && message.id !== undefined) {
                    const pending = this.pending.get(Number(message.id));
                    if (pending) {
                        this.pending.delete(Number(message.id));
                        if ("error" in message && message.error) {
                            pending.reject(new Error(message.error.message || "MCP stdio request failed."));
                        } else {
                            pending.resolve((message as JsonRpcResponse).result ?? {});
                        }
                    }
                    continue;
                }

                if ("method" in message) {
                    logger.debug("stdio.notification", {server: this.config.name, method: message.method});
                }
            } catch (error) {
                logger.warn("stdio.parse_failed", {
                    server: this.config.name,
                    line: line.slice(0, 500),
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    private failAll(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }

    async request(method: string, params?: BoundaryValue): Promise<BoundaryValue> {
        if (this.process.exitCode !== null) {
            throw new Error(`MCP stdio server '${this.config.name}' is not running.`);
        }

        const id = this.nextId++;
        const request: JsonRpcRequest = {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };

        const result = new Promise<BoundaryValue>((resolve, reject) => {
            this.pending.set(id, {resolve, reject});
        });

        this.process.stdin.write(`${JSON.stringify(request)}\n`);
        return timeoutPromise(result, this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, `${this.config.name}.${method}`);
    }

    async notify(method: string, params?: BoundaryValue): Promise<void> {
        if (this.process.exitCode !== null) {
            throw new Error(`MCP stdio server '${this.config.name}' is not running.`);
        }

        const notification: JsonRpcNotification = {
            jsonrpc: "2.0",
            method,
            params,
        };

        this.process.stdin.write(`${JSON.stringify(notification)}\n`);
    }

    async close(): Promise<void> {
        this.failAll(new Error(`MCP stdio server '${this.config.name}' closed.`));
        if (!this.process.killed) {
            this.process.kill();
        }
    }
}

class HttpJsonRpcTransport implements JsonRpcTransport {
    private nextId = 1;
    private sessionId?: string;

    constructor(private readonly config: McpServerConfig) {
        if (!config.url) {
            throw new Error(`MCP HTTP server '${config.name}' is missing url.`);
        }
    }

    private async post(body: BoundaryValue): Promise<Response> {
        const controller = new AbortController();
        const timeoutMs = this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(this.config.url!, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    ...(this.sessionId ? {"Mcp-Session-Id": this.sessionId} : {}),
                    ...(this.config.headers ?? {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            }).finally(() => clearTimeout(timeoutId));
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    async request(method: string, params?: BoundaryValue): Promise<BoundaryValue> {
        const id = this.nextId++;
        const request: JsonRpcRequest = {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };

        const response = await this.post(request);
        const sessionId = response.headers.get("Mcp-Session-Id");
        if (sessionId) {
            this.sessionId = sessionId;
        }

        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`MCP HTTP server '${this.config.name}' returned ${response.status}: ${errorText || response.statusText}`);
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        let payload: BoundaryValue;

        if (contentType.includes("text/event-stream")) {
            const text = await response.text();
            const messages = parseSsePayload(text);
            const responseMessage = messages.map(toJsonRpcResponse).find(message => message?.id === id && (message.result !== undefined || message.error));
            payload = extractJsonRpcResult(responseMessage ?? messages[0] ?? {}, id);
        } else {
            payload = extractJsonRpcResult(await response.json() as BoundaryValue, id);
        }

        return payload;
    }

    async notify(method: string, params?: BoundaryValue): Promise<void> {
        const response = await this.post({
            jsonrpc: "2.0",
            method,
            params,
        });

        const sessionId = response.headers.get("Mcp-Session-Id");
        if (sessionId) {
            this.sessionId = sessionId;
        }

        if (!response.ok && response.status !== 202) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`MCP HTTP notification failed for '${this.config.name}' with ${response.status}: ${errorText || response.statusText}`);
        }
    }

    async close(): Promise<void> {
        return;
    }
}

function createTransport(config: McpServerConfig): JsonRpcTransport {
    return config.transport === "stdio"
        ? new StdioJsonRpcTransport(config)
        : new HttpJsonRpcTransport(config);
}

function normalizeToolResultContent(content: BoundaryValue): string {
    if (content === undefined || content === null) return "";
    if (typeof content === "string") return content;
    if (typeof content === "number" || typeof content === "boolean") return String(content);
    if (Array.isArray(content)) return content.map(item => normalizeToolResultContent(item)).filter(Boolean).join("\n");
    if (!isRecord(content)) return JSON.stringify(content);

    if (content.type === "text" && typeof content.text === "string") return content.text;
    if (content.type === "image") {
        return `[image ${typeof content.mimeType === "string" ? content.mimeType : "unknown"}]`;
    }
    if (content.type === "resource" && isRecord(content.resource)) {
        if (typeof content.resource.text === "string") return content.resource.text;
        return JSON.stringify(content.resource);
    }

    return JSON.stringify(content);
}

export class McpClient {
    private readonly transport: JsonRpcTransport;
    private initialized = false;

    constructor(readonly config: McpServerConfig) {
        this.transport = createTransport(config);
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        await this.transport.request("initialize", {
            protocolVersion: MCP_PROTOCOL_VERSION,
            clientInfo: {
                name: "tg-chat-bot",
                version: "1.0.0",
            },
            capabilities: {},
        });

        await this.transport.notify("notifications/initialized");
        this.initialized = true;
    }

    async listTools(): Promise<McpToolDefinition[]> {
        await this.initialize();
        const result = await this.transport.request("tools/list");

        if (!isRecord(result)) return [];

        const tools = Array.isArray(result.tools) ? result.tools : [];
        return tools.flatMap(tool => {
            if (!isRecord(tool) || typeof tool.name !== "string") return [];
            return [{
                name: tool.name,
                description: typeof tool.description === "string" ? tool.description : undefined,
                inputSchema: tool.inputSchema,
            }];
        });
    }

    async callTool(name: string, args?: BoundaryValue): Promise<string> {
        await this.initialize();
        const result = await this.transport.request("tools/call", {
            name,
            arguments: args ?? {},
        });

        if (!isRecord(result)) {
            return normalizeToolResultContent(result);
        }

        const content = Array.isArray(result.content) ? result.content : [];
        const text = content.map(item => normalizeToolResultContent(item)).filter(Boolean).join("\n");

        if (result.isError) {
            return text ? `[MCP error] ${text}` : "[MCP error]";
        }

        return text || JSON.stringify(result);
    }

    async close(): Promise<void> {
        await this.transport.close();
    }
}
