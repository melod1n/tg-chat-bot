import {Environment} from "../common/environment.js";
import {AiProvider} from "../model/ai-provider.js";
import type {BoundaryValue} from "../common/boundary-types.js";
import type {TelegramStreamMessage} from "./telegram-stream-message.js";
import type {RuntimeConfigSnapshot} from "./unified-ai-runner.shared.js";
import {filterRankedTools} from "./tool-ranker-pipeline.js";
import {ToolRanker} from "./unified-ai-runner.tool-ranker.js";
import {storeToolRankAudit} from "./tool-rank-audit.js";

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
}): Promise<{
    filteredTools: BoundaryValue[];
    selectedToolNames: string[];
    usedRanker: boolean;
}> {
    const toolRanker = params.toolRanker ?? new ToolRanker(params.config);
    const startedAt = Date.now();
    const startedAtIso = new Date().toISOString();

    params.streamMessage.setStatus(Environment.getSelectingToolsText());
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
        await storeToolRankAudit({
            streamMessage: params.streamMessage,
            provider: params.provider,
            model: params.model,
            round: params.round,
            startedAt,
            startedAtIso,
            selectedTools: selection.toolNames,
        });

        return {
            filteredTools: filterRankedTools(params.availableTools, selection.toolNames),
            selectedToolNames: selection.toolNames,
            usedRanker: selection.usedRanker,
        };
    } catch (error) {
        params.streamMessage.clearStatus();
        await params.streamMessage.flush();
        await storeToolRankAudit({
            streamMessage: params.streamMessage,
            provider: params.provider,
            model: params.model,
            round: params.round,
            startedAt,
            startedAtIso,
            error,
        });
        throw error;
    }
}
