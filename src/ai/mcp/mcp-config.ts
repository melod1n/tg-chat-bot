import type {BoundaryValue} from "../../common/boundary-types.js";

export type McpTransport = "stdio" | "http";

export type McpServerConfig = {
    name: string;
    transport: McpTransport;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
};

function isRecord(value: BoundaryValue): value is Record<string, BoundaryValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: BoundaryValue): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toStringRecord(value: BoundaryValue): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined;

    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
            result[key] = String(entry);
        }
    }

    return Object.keys(result).length ? result : undefined;
}

function toStringArray(value: BoundaryValue): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map(item => item.trim());
    return items.length ? items : undefined;
}

function toPositiveInt(value: BoundaryValue): number | undefined {
    const n = typeof value === "number"
        ? value
        : typeof value === "string"
            ? Number(value)
            : NaN;

    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
}

function normalizeServerConfig(value: BoundaryValue, fallbackName?: string): McpServerConfig | undefined {
    if (!isRecord(value)) return undefined;

    const name = asString(value.name) ?? fallbackName;
    const transportRaw = asString(value.transport);
    const transport = transportRaw === "http" || transportRaw === "stdio" ? transportRaw : undefined;

    if (!name || !transport) return undefined;

    return {
        name,
        transport,
        command: asString(value.command),
        args: toStringArray(value.args),
        cwd: asString(value.cwd),
        env: toStringRecord(value.env),
        url: asString(value.url),
        headers: toStringRecord(value.headers),
        timeoutMs: toPositiveInt(value.timeoutMs),
    };
}

export function parseMcpServerConfigs(raw: string | undefined): McpServerConfig[] {
    if (!raw?.trim()) return [];

    let parsed: BoundaryValue;
    try {
        parsed = JSON.parse(raw) as BoundaryValue;
    } catch (error) {
        throw new Error(`Invalid MCP_SERVERS JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (Array.isArray(parsed)) {
        return parsed.flatMap((item, index) => normalizeServerConfig(item, `server-${index + 1}`) ? [normalizeServerConfig(item, `server-${index + 1}`)!] : []);
    }

    if (!isRecord(parsed)) {
        return [];
    }

    if (Array.isArray(parsed.servers)) {
        return parsed.servers.flatMap((item, index) => normalizeServerConfig(item, `server-${index + 1}`) ? [normalizeServerConfig(item, `server-${index + 1}`)!] : []);
    }

    if (isRecord(parsed.mcpServers)) {
        return Object.entries(parsed.mcpServers).flatMap(([name, item]) => normalizeServerConfig(item, name) ? [normalizeServerConfig(item, name)!] : []);
    }

    const single = normalizeServerConfig(parsed);
    return single ? [single] : [];
}
