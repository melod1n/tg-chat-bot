import {AiProvider} from "../model/ai-provider";
import type {StoredAttachment} from "../model/stored-attachment";
import {persistInternalJsonArtifactAttachment} from "./internal-artifact-store";

export async function persistFinalTextArtifactAttachment(params: {
    provider: AiProvider;
    model: string;
    text: string;
    chatId: number;
    messageId: number;
}): Promise<StoredAttachment | undefined> {
    const text = params.text.trim();
    if (!text) return Promise.resolve(undefined);

    return await persistInternalJsonArtifactAttachment({
        artifactKind: "final_text",
        fileNamePrefix: "final-text",
        chatId: params.chatId,
        messageId: params.messageId,
        payload: {
            provider: params.provider,
            model: params.model,
            text,
        },
        metadata: {
            provider: params.provider,
            model: params.model,
            textChars: text.length,
        },
    });
}

export async function persistErrorArtifactAttachment(params: {
    provider: AiProvider;
    model: string;
    message: string;
    recoverable: boolean;
    chatId: number;
    messageId: number;
}): Promise<StoredAttachment> {
    return await persistInternalJsonArtifactAttachment({
        artifactKind: "error",
        fileNamePrefix: "error",
        chatId: params.chatId,
        messageId: params.messageId,
        payload: {
            provider: params.provider,
            model: params.model,
            message: params.message,
            recoverable: params.recoverable,
        },
        metadata: {
            provider: params.provider,
            model: params.model,
            recoverable: params.recoverable,
        },
    });
}
