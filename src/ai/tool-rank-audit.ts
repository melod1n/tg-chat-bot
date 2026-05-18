import {AiProvider} from "../model/ai-provider";
import type {TelegramStreamMessage} from "./telegram-stream-message";
import type {PipelineAuditEvent} from "./user-request-pipeline";
import {logError} from "../util/utils";

export async function storeToolRankAudit(params: {
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
}): Promise<void> {
    const event: PipelineAuditEvent = {
        stage: "tool_rank",
        status: params.error ? "failed" : "succeeded",
        startedAt: params.startedAtIso,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - params.startedAt,
        provider: params.provider,
        model: params.model,
        details: {
            round: params.round,
            availableTools: params.availableTools,
            selectedTools: params.selectedTools ?? [],
            usedRanker: params.usedRanker ?? false,
            toolRankDecision: {
                provider: params.provider,
                round: params.round,
                availableTools: params.availableTools,
                selectedTools: params.selectedTools ?? [],
                usedRanker: params.usedRanker ?? false,
            },
        },
        error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined,
    };

    await params.streamMessage.storePipelineAudit([event]).catch(logError);
}
