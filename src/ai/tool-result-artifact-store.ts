import type {StoredAttachment} from "../model/stored-attachment";
import type {ToolCallData} from "./unified-ai-runner.shared";
import {persistInternalJsonArtifactAttachment} from "./internal-artifact-store";

export async function persistToolResultArtifactAttachment(params: {
    toolCall: ToolCallData;
    resultText: string;
    chatId: number;
    messageId: number;
}): Promise<StoredAttachment> {
    return await persistInternalJsonArtifactAttachment({
        artifactKind: "tool_result",
        fileNamePrefix: `tool-${params.toolCall.name}`,
        chatId: params.chatId,
        messageId: params.messageId,
        payload: {
            toolName: params.toolCall.name,
            callId: params.toolCall.id,
            argumentsText: params.toolCall.argumentsText,
            resultText: params.resultText,
        },
        metadata: {
            toolName: params.toolCall.name,
            callId: params.toolCall.id,
            resultChars: params.resultText.length,
        },
    });
}
