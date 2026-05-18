import {AiProvider} from "../model/ai-provider.js";
import type {BoundaryValue} from "../common/boundary-types.js";
import type {TelegramStreamMessage} from "./telegram-stream-message.js";
import type {RuntimeConfigSnapshot} from "./unified-ai-runner.shared.js";
import {allToolSchemaNames, toolSchemaNames} from "./tool-schema-utils.js";
import type {ToolRanker} from "./unified-ai-runner.tool-ranker.js";

function latestUserText(messages: readonly { role?: string; content?: unknown }[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== "user") continue;
        if (typeof message.content === "string") return message.content;
        if (Array.isArray(message.content)) {
            return message.content
                .map(part => typeof part === "object" && part !== null && "text" in part && typeof (part as { text?: unknown }).text === "string"
                    ? (part as { text: string }).text
                    : "")
                .filter(Boolean)
                .join("\n");
        }
    }

    return "";
}

export async function runToolRankStage(params: {
    provider: AiProvider;
    model: string;
    round: number;
    config: RuntimeConfigSnapshot;
    availableTools: readonly BoundaryValue[];
    messages: readonly { role?: string; content?: unknown }[];
    streamMessage: TelegramStreamMessage;
    signal: AbortSignal;
    toolRanker?: ToolRanker;
    storeAudit?: (params: {
        streamMessage: TelegramStreamMessage;
        provider: AiProvider;
        model: string;
        round: number;
        startedAt: number;
        startedAtIso: string;
        availableTools: string[];
        selectedTools?: string[];
        usedRanker?: boolean;
        error?: unknown;
    }) => Promise<void>;
}): Promise<{
    filteredTools: BoundaryValue[];
    selectedToolNames: string[];
    usedRanker: boolean;
}> {
    const toolRanker = params.toolRanker ?? new (await import("./unified-ai-runner.tool-ranker.js")).ToolRanker(params.config);
    const startedAt = Date.now();
    const startedAtIso = new Date().toISOString();
    const storeAudit = params.storeAudit ?? (await import("./tool-rank-audit.js")).storeToolRankAudit;
    const filterSelectedTools = (selectedToolNames: readonly string[]): BoundaryValue[] => {
        const selected = new Set(selectedToolNames);
        return params.availableTools.filter(tool => toolSchemaNames(tool).some(name => selected.has(name)));
    };

    params.streamMessage.setStatus("🧩 Выбираю подходящие инструменты...");
    await params.streamMessage.flush();

    try {
        const selection = await toolRanker.selectTools({
            provider: params.provider,
            userQuery: latestUserText(params.messages),
            availableTools: params.availableTools,
            round: params.round,
            signal: params.signal,
        });

        params.streamMessage.clearStatus();
        await params.streamMessage.flush();
        await storeAudit({
            streamMessage: params.streamMessage,
            provider: params.provider,
            model: params.model,
            round: params.round,
            startedAt,
            startedAtIso,
            availableTools: allToolSchemaNames(params.availableTools),
            selectedTools: selection.toolNames,
            usedRanker: selection.usedRanker,
        });

        return {
            filteredTools: filterSelectedTools(selection.toolNames),
            selectedToolNames: selection.toolNames,
            usedRanker: selection.usedRanker,
        };
    } catch (error) {
        params.streamMessage.clearStatus();
        await params.streamMessage.flush();
        await storeAudit({
            streamMessage: params.streamMessage,
            provider: params.provider,
            model: params.model,
            round: params.round,
            startedAt,
            startedAtIso,
            availableTools: allToolSchemaNames(params.availableTools),
            error,
        });
        throw error;
    }
}
