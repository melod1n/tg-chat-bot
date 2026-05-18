import type {StoredAttachment} from "../model/stored-attachment";
import type {TelegramOutputAttachmentRecord, TelegramToolExecutionRecord} from "./telegram-stream-message.js";
import {persistInternalJsonArtifactAttachment} from "./internal-artifact-store";

export async function persistToolLoopSummaryArtifactAttachment(params: {
    chatId: number;
    messageId: number;
    text: string;
    executions: readonly TelegramToolExecutionRecord[];
    outputAttachments: readonly TelegramOutputAttachmentRecord[];
}): Promise<StoredAttachment | undefined> {
    if (!params.executions.length) return undefined;

    return await persistInternalJsonArtifactAttachment({
        artifactKind: "tool_result",
        fileNamePrefix: "tool-loop-summary",
        chatId: params.chatId,
        messageId: params.messageId,
        payload: {
            stage: "tool_loop",
            text: params.text.trim(),
            executions: params.executions.map(execution => ({
                toolName: execution.toolName,
                callId: execution.callId,
                argumentsText: execution.argumentsText,
                resultChars: execution.resultChars,
                startedAt: execution.startedAt,
                finishedAt: execution.finishedAt,
            })),
            outputAttachments: params.outputAttachments,
        },
        metadata: {
            stage: "tool_loop",
            toolExecutions: params.executions.length,
            outputAttachments: params.outputAttachments.length,
            textChars: params.text.trim().length,
        },
    });
}
