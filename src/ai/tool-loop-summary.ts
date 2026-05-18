import type {PipelineArtifact} from "./user-request-pipeline/types.js";
import type {TelegramOutputAttachmentRecord, TelegramToolExecutionRecord} from "./telegram-stream-message.js";
import {summarizeModelOutput} from "./response-model-output.js";

export type ToolLoopSummary = {
    status: "succeeded" | "skipped";
    fallbackAction?: "continue_without_stage";
    details: {
        modelOutput: ReturnType<typeof summarizeModelOutput>;
        count: number;
        tools: Array<{
            toolName: string;
            callId: string;
            resultChars: number;
        }>;
    };
    artifacts?: PipelineArtifact[];
};

export function summarizeToolLoop(params: {
    text: string;
    executions: readonly TelegramToolExecutionRecord[];
    outputAttachments: readonly TelegramOutputAttachmentRecord[];
}): ToolLoopSummary {
    const count = params.executions.length;
    const tools = params.executions.map(execution => ({
        toolName: execution.toolName,
        callId: execution.callId,
        resultChars: execution.resultChars,
    }));

    return {
        status: count ? "succeeded" : "skipped",
        fallbackAction: count ? undefined : "continue_without_stage",
        details: {
            modelOutput: summarizeModelOutput({
                text: params.text,
                toolExecutions: params.executions,
                outputAttachments: params.outputAttachments,
            }),
            count,
            tools,
        },
        artifacts: count ? [{
            kind: "tool_result",
            stage: "tool_loop",
            createdAt: new Date().toISOString(),
            toolName: "summary",
            callId: "tool_loop_summary",
            resultText: JSON.stringify({
                count,
                tools,
            }),
        }] : undefined,
    };
}
