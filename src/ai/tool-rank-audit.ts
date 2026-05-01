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
    selectedTools?: string[];
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
            selectedTools: params.selectedTools ?? [],
        },
        error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined,
    };

    await params.streamMessage.storePipelineAudit([event]).catch(logError);
}
