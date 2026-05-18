import {Environment} from "../../common/environment.js";
import type {AiTool} from "../tool-types.js";
import type {ToolHandler} from "../tools/types.js";
import {normalizeToolArguments} from "../tools/utils.js";
import {toolsLogger} from "../tools/tool-logger.js";
import {convertJsonSchemaToToolParameters} from "./mcp-json-schema.js";
import {McpClient, type McpToolDefinition} from "./mcp-client.js";
import {parseMcpServerConfigs, type McpServerConfig} from "./mcp-config.js";

const logger = toolsLogger.child("mcp-registry");

type McpToolBinding = {
    server: McpServerConfig;
    client: McpClient;
    remoteToolName: string;
    localToolName: string;
    tool: AiTool;
};

type McpInitSummary = {
    servers: number;
    loadedServers: number;
    tools: number;
    failedServers: string[];
};

const toolBindings = new Map<string, McpToolBinding>();
const clients = new Map<string, McpClient>();
let initPromise: Promise<McpInitSummary> | undefined;

function sanitizeSegment(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "tool";
}

function buildLocalToolName(serverName: string, toolName: string): string {
    return `mcp__${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`;
}

function buildTool(serverName: string, tool: McpToolDefinition): AiTool {
    const localName = buildLocalToolName(serverName, tool.name);
    const description = tool.description?.trim()
        ? `[MCP ${serverName}] ${tool.description.trim()}`
        : `[MCP ${serverName}] ${tool.name}`;

    return {
        type: "function",
        function: {
            name: localName,
            description,
            parameters: convertJsonSchemaToToolParameters(tool.inputSchema),
        },
    };
}

async function loadServer(config: McpServerConfig): Promise<{loaded: boolean; tools: number}> {
    const client = new McpClient(config);
    clients.set(config.name, client);

    try {
        const remoteTools = await client.listTools();
        let loaded = 0;

        for (const remoteTool of remoteTools) {
            const localName = buildLocalToolName(config.name, remoteTool.name);
            if (toolBindings.has(localName)) {
                logger.warn("tool.duplicate", {
                    server: config.name,
                    tool: remoteTool.name,
                    localName,
                });
                continue;
            }

            const binding: McpToolBinding = {
                server: config,
                client,
                remoteToolName: remoteTool.name,
                localToolName: localName,
                tool: buildTool(config.name, remoteTool),
            };

            toolBindings.set(localName, binding);
            loaded += 1;
        }

        logger.info("server.loaded", {
            server: config.name,
            transport: config.transport,
            tools: loaded,
        });
        return {loaded: true, tools: loaded};
    } catch (error) {
        logger.error("server.failed", {
            server: config.name,
            transport: config.transport,
            error: error instanceof Error ? error.message : String(error),
        });
        await client.close().catch(() => undefined);
        clients.delete(config.name);
        return {loaded: false, tools: 0};
    }
}

export async function initializeMcpTools(): Promise<McpInitSummary> {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        toolBindings.clear();
        await Promise.all([...clients.values()].map(client => client.close().catch(() => undefined)));
        clients.clear();

        const configs = parseMcpServerConfigs(Environment.MCP_SERVERS);
        const results = await Promise.all(configs.map(config => loadServer(config)));

        return {
            servers: configs.length,
            loadedServers: results.filter(result => result.loaded).length,
            tools: [...results].reduce((sum, result) => sum + result.tools, 0),
            failedServers: configs.filter((_, index) => !results[index]?.loaded).map(config => config.name),
        };
    })();

    try {
        const summary = await initPromise;
        logger.info("init.done", summary);
        return summary;
    } catch (error) {
        initPromise = undefined;
        logger.error("init.failed", {error: error instanceof Error ? error.message : String(error)});
        throw error;
    }
}

export function getMcpTools(): AiTool[] {
    return [...toolBindings.values()].map(binding => binding.tool);
}

export function getMcpToolHandlers(): Record<string, ToolHandler> {
    const handlers: Record<string, ToolHandler> = {};

    for (const binding of toolBindings.values()) {
        handlers[binding.localToolName] = async args => {
            const normalized = normalizeToolArguments(args, undefined);
            return binding.client.callTool(binding.remoteToolName, normalized);
        };
    }

    return handlers;
}

export function getMcpToolPrompts(_toolNames: string[]): string[] {
    return [];
}

export async function shutdownMcpTools(): Promise<void> {
    initPromise = undefined;
    toolBindings.clear();

    await Promise.all([...clients.values()].map(client => client.close().catch(() => undefined)));
    clients.clear();
}
