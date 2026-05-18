import {Message} from "typescript-telegram-bot-api";
import {createLogger, formatDuration, LogDetails, LogLevel} from "./logger.js";

export type AiRunnerLogLevel = LogLevel;
export type AiRunnerLogDetails = LogDetails;

export type AiLogToolCallLike = {
    id: string;
    name: string;
    argumentsText: string;
};

const aiRunnerLogger = createLogger("unified-ai-runner", {
    envPrefix: "AI",
    defaultLevel: "debug",
    enabledEnvNames: ["AI_RUNNER_LOGS", "AI_LOG_ENABLED"],
    colorsEnvNames: ["AI_RUNNER_LOG_COLORS", "AI_LOG_COLORS"],
});

function safeJsonParseObject(value?: string): LogDetails {
    if (!value?.trim()) return {};

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as LogDetails
            : {};
    } catch {
        return {};
    }
}

export function aiLog(level: AiRunnerLogLevel, event: string, details?: AiRunnerLogDetails): void {
    aiRunnerLogger[level](event, details);
}

export function aiLogDuration(startedAt: number): string {
    return formatDuration(startedAt);
}

export function aiLogToolCall(toolCall: AiLogToolCallLike): LogDetails {
    return {
        id: toolCall.id,
        name: toolCall.name,
        arguments: safeJsonParseObject(toolCall.argumentsText),
    };
}

export function aiLogMessageIdentity(msg: Message | undefined): LogDetails | undefined {
    if (!msg) return undefined;
    return {
        chatId: msg.chat?.id,
        chatType: msg.chat?.type,
        messageId: msg.message_id,
        fromId: msg.from?.id,
        username: msg.from?.username,
    };
}

export function aiLogProviderTarget(target: {provider: string; purpose?: string; model?: string; baseUrl?: string; apiKey?: string} | undefined): LogDetails | undefined {
    if (!target) return undefined;
    return {
        provider: target.provider,
        purpose: target.purpose,
        model: target.model,
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
    };
}
