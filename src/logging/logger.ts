import type {BoundaryValue} from "../common/boundary-types";

export type LogLevel = "trace" | "debug" | "info" | "success" | "warn" | "error";

export type LogPrimitive = string | number | boolean | bigint | null | undefined;
export interface LogDetails {
    [key: string]: LogValue;
}
export type LogValue = LogPrimitive | Error | Date | Buffer | readonly LogValue[] | object | BoundaryValue;

export type LoggerOptions = {
    envPrefix?: string;
    defaultLevel?: LogLevel;
    enabledEnvNames?: readonly string[];
    colorsEnvNames?: readonly string[];
};

export type Logger = {
    scope: string;
    trace(event: string, details?: LogDetails): void;
    debug(event: string, details?: LogDetails): void;
    info(event: string, details?: LogDetails): void;
    success(event: string, details?: LogDetails): void;
    warn(event: string, details?: LogDetails): void;
    error(event: string, details?: LogDetails): void;
    child(scope: string, options?: LoggerOptions): Logger;
    duration(startedAt: number): string;
    enabled(level?: LogLevel): boolean;
};

const DEFAULT_MAX_STRING = 600;
const DEFAULT_MAX_ARRAY = 8;
const DEFAULT_MAX_DEPTH = 3;

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    success: 30,
    warn: 40,
    error: 50,
};

const LOG_COLORS: Record<LogLevel | "reset" | "bold" | "dim" | "label" | "key" | "value", string> = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    trace: "\x1b[90m",
    debug: "\x1b[90m",
    info: "\x1b[36m",
    success: "\x1b[32m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    label: "\x1b[35m",
    key: "\x1b[94m",
    value: "\x1b[97m",
};

const FALSE_VALUES = new Set(["0", "false", "no", "off", "disable", "disabled"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enable", "enabled"]);

export function envBool(name: string, defaultValue: boolean): boolean {
    const value = process.env[name];
    if (value === undefined) return defaultValue;

    const normalized = value.trim().toLowerCase();
    if (FALSE_VALUES.has(normalized)) return false;
    if (TRUE_VALUES.has(normalized)) return true;
    return defaultValue;
}

function envNumber(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (!raw?.trim()) return defaultValue;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function configuredMaxString(): number {
    return envNumber("LOG_MAX_STRING", DEFAULT_MAX_STRING);
}

function configuredMaxArray(): number {
    return envNumber("LOG_MAX_ARRAY", DEFAULT_MAX_ARRAY);
}

function configuredMaxDepth(): number {
    return envNumber("LOG_MAX_DEPTH", DEFAULT_MAX_DEPTH);
}

function isValidLogLevel(level: string): level is LogLevel {
    return level in LOG_LEVEL_WEIGHT;
}

function scopedEnvName(prefix: string | undefined, suffix: string): string | undefined {
    if (!prefix?.trim()) return undefined;
    return `${prefix.trim().toUpperCase()}_${suffix}`;
}

function configuredMinLevel(options: LoggerOptions): LogLevel {
    const scoped = scopedEnvName(options.envPrefix, "LOG_LEVEL");
    const raw = (scoped ? process.env[scoped] : undefined) ?? process.env.LOG_LEVEL;
    const normalized = raw?.trim().toLowerCase();

    if (normalized && isValidLogLevel(normalized)) return normalized;
    return options.defaultLevel ?? "debug";
}

function envChainEnabled(names: readonly string[], defaultValue: boolean): boolean {
    return names.every(name => envBool(name, defaultValue));
}

function logsEnabled(options: LoggerOptions): boolean {
    const scoped = scopedEnvName(options.envPrefix, "LOG_ENABLED");
    const names = [
        "LOG_ENABLED",
        "APP_LOG_ENABLED",
        ...(scoped ? [scoped] : []),
        ...(options.enabledEnvNames ?? []),
    ];

    return envChainEnabled(names, true);
}

function colorsEnabled(options: LoggerOptions): boolean {
    if (process.env.NO_COLOR) return false;

    const scoped = scopedEnvName(options.envPrefix, "LOG_COLORS");
    const names = [
        "LOG_COLORS",
        ...(scoped ? [scoped] : []),
        ...(options.colorsEnvNames ?? []),
    ];

    return envChainEnabled(names, true);
}

function shouldWriteLevel(level: LogLevel, options: LoggerOptions): boolean {
    return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[configuredMinLevel(options)];
}

function paint(value: string, color: keyof typeof LOG_COLORS, options: LoggerOptions): string {
    if (!colorsEnabled(options)) return value;
    return `${LOG_COLORS[color]}${value}${LOG_COLORS.reset}`;
}

export function truncateLogString(value: string, max = configuredMaxString()): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}… (+${value.length - max} chars)`;
}

function isSecretKey(keyPath: string): boolean {
    const normalized = keyPath.toLowerCase();
    return normalized.includes("token")
        || normalized.includes("secret")
        || normalized.includes("password")
        || normalized.includes("passwd")
        || normalized.includes("apikey")
        || normalized.includes("api_key")
        || normalized.includes("authorization")
        || normalized.includes("cookie")
        || normalized.includes("session")
        || normalized.endsWith(".key")
        || normalized === "key";
}

function isPromptKey(keyPath: string): boolean {
    const normalized = keyPath.toLowerCase();
    return normalized.includes("prompt") || normalized.includes("systemprompt");
}

function isTextPreviewKey(keyPath: string): boolean {
    const normalized = keyPath.toLowerCase();
    return normalized.includes("content")
        || normalized.includes("message")
        || normalized.includes("text")
        || normalized.includes("preview")
        || normalized.includes("input")
        || normalized.includes("output")
        || normalized.includes("transcript");
}

function isToolArgsKey(keyPath: string): boolean {
    const normalized = keyPath.toLowerCase();
    return normalized.endsWith("args")
        || normalized.endsWith("arguments")
        || normalized.includes("toolargs")
        || normalized.includes("tool_args");
}

function isDaoKey(keyPath: string): boolean {
    const normalized = keyPath.toLowerCase();
    return normalized.includes("dao")
        || normalized.includes("database")
        || normalized.includes("db.")
        || normalized.includes("sql")
        || normalized.includes("chunk");
}

function shouldRedactKey(keyPath: string): boolean {
    if (isSecretKey(keyPath)) return true;
    if (isPromptKey(keyPath) && !envBool("AI_LOG_PROMPTS", false)) return true;
    if (isToolArgsKey(keyPath) && !envBool("AI_LOG_TOOL_ARGS", false)) return true;
    if (isDaoKey(keyPath) && !envBool("AI_LOG_DAO", false)) return true;
    if (isTextPreviewKey(keyPath) && !envBool("AI_LOG_TEXT_PREVIEW", false)) return true;
    return false;
}

function primitiveToLogValue(value: LogValue): LogValue | undefined {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack?.split("\n").slice(0, 8).join("\n"),
        };
    }

    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return truncateLogString(value);
    if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
    if (typeof value === "bigint") return value.toString();
    if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
    return undefined;
}

function looksLikeLargeBinaryKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return normalized === "data"
        || normalized === "image_url"
        || normalized.endsWith("b64")
        || normalized.endsWith("base64")
        || normalized.includes("binary");
}

export function flattenLogDetails(
    value: LogValue,
    keyPath = "",
    depth = 0,
    seen = new WeakSet<object>(),
): LogDetails {
    if (keyPath && shouldRedactKey(keyPath)) {
        return {[keyPath]: "<redacted>"};
    }

    const primitive = primitiveToLogValue(value);
    if (primitive !== undefined || value === undefined) {
        return keyPath ? {[keyPath]: primitive} : {value: primitive};
    }

    if (typeof value !== "object" || value === null) {
        return keyPath ? {[keyPath]: String(value)} : {value: String(value)};
    }

    if (seen.has(value)) {
        return keyPath ? {[keyPath]: "[Circular]"} : {value: "[Circular]"};
    }
    seen.add(value);

    if (Array.isArray(value)) {
        if (depth >= configuredMaxDepth()) {
            return keyPath ? {[keyPath]: `[Array ${value.length}]`} : {value: `[Array ${value.length}]`};
        }

        const entries: LogDetails = {};
        value.slice(0, configuredMaxArray()).forEach((item, index) => {
            Object.assign(entries, flattenLogDetails(item, keyPath ? `${keyPath}.${index}` : String(index), depth + 1, seen));
        });
        if (value.length > configuredMaxArray()) {
            entries[keyPath ? `${keyPath}.__more` : "__more"] = value.length - configuredMaxArray();
        }
        return entries;
    }

    if (depth >= configuredMaxDepth()) {
        return keyPath ? {[keyPath]: "[Object]"} : {value: "[Object]"};
    }

    const entries: LogDetails = {};
    for (const [key, raw] of Object.entries(value as Record<string, LogValue>)) {
        const childPath = keyPath ? `${keyPath}.${key}` : key;
        if (looksLikeLargeBinaryKey(key) && typeof raw === "string") {
            entries[childPath] = `<${raw.length} chars>`;
            continue;
        }

        Object.assign(entries, flattenLogDetails(raw, childPath, depth + 1, seen));
    }

    return entries;
}

export function redactLogValue(value: LogValue): LogDetails {
    return flattenLogDetails(value);
}

function formatDetails(details: LogDetails | undefined, options: LoggerOptions): string {
    if (!details || !Object.keys(details).length) return "";

    const flattened = flattenLogDetails(details);
    const chunks = Object.entries(flattened).map(([key, value]) => {
        const safeValue = typeof value === "string" ? value : JSON.stringify(value);
        return `${paint(key, "key", options)}=${paint(safeValue ?? "undefined", "value", options)}`;
    });

    return ` ${chunks.join(" ")}`;
}

function writeLine(level: LogLevel, line: string): void {
    if (level === "error") {
        console.error(line);
        return;
    }

    if (level === "warn") {
        console.warn(line);
        return;
    }

    console.log(line);
}

export function formatDuration(startedAt: number): string {
    const ms = Date.now() - startedAt;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
    const normalizedScope = scope.trim() || "app";
    const resolvedOptions = {...options};

    const log = (level: LogLevel, event: string, details?: LogDetails): void => {
        if (!logsEnabled(resolvedOptions) || !shouldWriteLevel(level, resolvedOptions)) return;

        const timestamp = paint(new Date().toISOString(), "dim", resolvedOptions);
        const prefix = paint(normalizedScope, "bold", resolvedOptions);
        const levelText = paint(level.toUpperCase().padEnd(7), level, resolvedOptions);
        const eventText = paint(event, "label", resolvedOptions);
        writeLine(level, `${timestamp} ${prefix} ${levelText} ${eventText}${formatDetails(details, resolvedOptions)}`);
    };

    return {
        scope: normalizedScope,
        trace: (event, details) => log("trace", event, details),
        debug: (event, details) => log("debug", event, details),
        info: (event, details) => log("info", event, details),
        success: (event, details) => log("success", event, details),
        warn: (event, details) => log("warn", event, details),
        error: (event, details) => log("error", event, details),
        child: (childScope, childOptions) => createLogger(`${normalizedScope}:${childScope}`, {...resolvedOptions, ...childOptions}),
        duration: formatDuration,
        enabled: (level = "debug") => logsEnabled(resolvedOptions) && shouldWriteLevel(level, resolvedOptions),
    };
}

export const appLogger = createLogger("app", {envPrefix: "APP", defaultLevel: "debug"});
