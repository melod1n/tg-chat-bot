import type {Message} from "typescript-telegram-bot-api";
import {AiProvider} from "../../model/ai-provider";
import type {StoredMessage} from "../../model/stored-message";
import type {StoredAttachment} from "../../model/stored-attachment";
import {MessageStore} from "../../common/message-store";
import {Environment} from "../../common/environment";
import {
    DEFAULT_AI_IMAGE_OUTPUT_MODE,
    DEFAULT_AI_RESPONSE_LANGUAGE,
    DEFAULT_AI_VOICE_MODE,
} from "../../common/user-ai-settings";
import {
    cacheMessageAttachmentsWithRejections,
    collectTelegramAttachmentDescriptors,
    type RejectedTelegramAttachment,
} from "../telegram-attachments";
import {PIPELINE_ATTACHMENT_LIMIT_BYTES, type PersistentAttachment, type UserRequestPipelineState} from "./types";
import {UserRequestPipeline} from "./pipeline";
import type {UserRequestPipelineStage} from "./types";

type TelegramMessageAttachmentPipelineResult = {
    state: UserRequestPipelineState;
    storedMessage: StoredMessage;
    attachments: StoredAttachment[];
    rejected: RejectedTelegramAttachment[];
};

function nowIso(): string {
    return new Date().toISOString();
}

function requestIdFor(msg: Message): string {
    return `telegram:${msg.chat.id}:${msg.message_id}:${Date.now()}`;
}

function rejectedKey(attachment: Pick<RejectedTelegramAttachment, "fileId" | "fileName">): string {
    return `${attachment.fileId}:${attachment.fileName}`;
}

function dedupeRejected(attachments: RejectedTelegramAttachment[]): RejectedTelegramAttachment[] {
    const seen = new Set<string>();
    const result: RejectedTelegramAttachment[] = [];

    for (const attachment of attachments) {
        const key = rejectedKey(attachment);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(attachment);
    }

    return result;
}

function storedToPersistentAttachment(msg: Message, attachment: StoredAttachment): PersistentAttachment {
    return {
        direction: "input",
        kind: attachment.kind,
        fileId: attachment.fileId,
        fileUniqueId: attachment.fileUniqueId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes ?? 0,
        cachePath: attachment.cachePath,
        sha256: attachment.sha256,
        sourceChatId: msg.chat.id,
        sourceMessageId: msg.message_id,
    };
}

export async function runTelegramMessageAttachmentPipeline(
    msg: Message,
    storedMessage: StoredMessage,
): Promise<TelegramMessageAttachmentPipelineResult> {
    let downloadedAttachments: StoredAttachment[] = [];
    let rejectedAttachments: RejectedTelegramAttachment[] = [];
    let persistedMessage = storedMessage;

    const state: UserRequestPipelineState = {
        requestId: requestIdFor(msg),
        chatId: msg.chat.id,
        messageId: msg.message_id,
        replyToMessageId: msg.reply_to_message?.message_id,
        fromId: msg.from?.id ?? storedMessage.fromId,
        receivedAt: nowIso(),
        text: storedMessage.text ?? msg.text ?? msg.caption ?? "",
        settings: {
            provider: Environment.DEFAULT_AI_PROVIDER ?? AiProvider.OLLAMA,
            responseLanguage: DEFAULT_AI_RESPONSE_LANGUAGE,
            voiceMode: DEFAULT_AI_VOICE_MODE,
            imageOutputMode: DEFAULT_AI_IMAGE_OUTPUT_MODE,
        },
        inputAttachments: [],
        outputAttachments: [],
        artifacts: [],
        toolRankDecisions: [],
        audit: [],
    };

    const stages: UserRequestPipelineStage[] = [
        {
            name: "input_size_gate",
            async run() {
                rejectedAttachments = dedupeRejected([
                    ...rejectedAttachments,
                    ...collectTelegramAttachmentDescriptors(msg)
                        .filter(attachment => (attachment.sizeBytes ?? 0) > PIPELINE_ATTACHMENT_LIMIT_BYTES)
                        .map(attachment => ({
                            kind: attachment.kind,
                            fileId: attachment.fileId,
                            fileUniqueId: attachment.fileUniqueId,
                            fileName: attachment.fileName,
                            mimeType: attachment.mimeType,
                            sizeBytes: attachment.sizeBytes ?? 0,
                            limitBytes: PIPELINE_ATTACHMENT_LIMIT_BYTES,
                            reason: "too_large" as const,
                        })),
                ]);

                return {
                    stage: "input_size_gate",
                    status: rejectedAttachments.length ? "fallback" : "succeeded",
                    fallbackAction: rejectedAttachments.length ? "notify_user" : undefined,
                };
            },
        },
        {
            name: "download_attachments",
            async run() {
                const result = await cacheMessageAttachmentsWithRejections(msg);
                downloadedAttachments = result.attachments;
                rejectedAttachments = dedupeRejected([...rejectedAttachments, ...result.rejected]);

                return {
                    stage: "download_attachments",
                    status: "succeeded",
                };
            },
        },
        {
            name: "normalize_attachments",
            async run() {
                return {
                    stage: "normalize_attachments",
                    status: "succeeded",
                    attachments: downloadedAttachments.map(attachment => storedToPersistentAttachment(msg, attachment)),
                };
            },
        },
        {
            name: "persist_input_attachments",
            async run() {
                if (downloadedAttachments.length) {
                    persistedMessage = {
                        ...persistedMessage,
                        attachments: downloadedAttachments,
                    };
                    persistedMessage = await MessageStore.put(persistedMessage);
                }

                return {
                    stage: "persist_input_attachments",
                    status: "succeeded",
                };
            },
        },
    ];

    const pipeline = new UserRequestPipeline({
        stages,
        stageNames: [
            "input_size_gate",
            "download_attachments",
            "normalize_attachments",
            "persist_input_attachments",
        ],
    });
    await pipeline.run(state, new AbortController().signal);
    persistedMessage = await MessageStore.put({
        ...persistedMessage,
        pipelineAudit: state.audit,
    });

    return {
        state,
        storedMessage: persistedMessage,
        attachments: downloadedAttachments,
        rejected: rejectedAttachments,
    };
}
