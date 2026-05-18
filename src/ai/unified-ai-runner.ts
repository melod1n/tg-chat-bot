// Facade extracted from unified-ai-runner.ts.
import {AiProvider} from "../model/ai-provider";
import {Environment} from "../common/environment";
import {ifTrue, logError, replyToMessage} from "../util/utils";
import {createAiCancelRequest, finishAiRequest, setAiCancelMessageId} from "./cancel-registry";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {AiDownloadedFile, attachmentsToDownloadedFiles, cleanupDownloads} from "./telegram-attachments";
import {aiProviderRequestQueue} from "./provider-request-queue";
import {
    AI_VOICE_MODE_TRANSCRIPT,
    resolveAiContextSizeForUser,
    resolveAiImageOutputModeForUser,
    resolveAiResponseLanguageForUser,
    resolveAiVoiceModeForUser
} from "../common/user-ai-settings";
import {buildAiRegenerateCallbackData} from "./regenerate-callback";
import {aiLog, aiLogDuration, aiLogMessageIdentity, aiLogProviderTarget} from "../logging/ai-logger";

import {
    AI_REQUEST_TIMEOUT_MS,
    collectCachedMessageAttachments,
    collectRequestedAttachmentKinds,
    hasAudioAttachmentKind,
    isAbortError,
    providerName,
    rejectUnsupportedAttachments,
    resolveAiRequestQueueTarget,
    RuntimeConfigSnapshot,
    snapshotModel,
    snapshotRuntimeConfig,
    UnifiedRunOptions
} from "./unified-ai-runner.shared";
import {prepareUnifiedAiRequestPipeline} from "./unified-ai-request-pipeline";
import {persistErrorArtifactAttachment} from "./final-response-artifact-store";
import {runUnifiedAiResponsePipeline} from "./unified-ai-response-pipeline";
import {AiRequestStore} from "../common/ai-request-store";
import type {StoredAiRequestStatus} from "../model/stored-ai-request";
import {recordAiRequestFinish, recordAiRequestStart} from "../common/ai-observability.js";

export type {ToolCallData} from "./unified-ai-runner.shared";
export {snapshotModel, providerTargets, ollamaModelNames} from "./unified-ai-runner.shared";

async function executeUnifiedAiRequest(
    options: UnifiedRunOptions,
    config: RuntimeConfigSnapshot,
    downloads: AiDownloadedFile[],
    controller: AbortController,
    streamMessage: TelegramStreamMessage,
): Promise<void> {
    const requestStartedAt = Date.now();
    let preparedRequest: Awaited<ReturnType<typeof prepareUnifiedAiRequestPipeline>> | undefined;
    aiLog("info", "request.execute.start", {
        requestId: options.requestId,
        provider: providerName(options.provider),
        stream: options.stream ?? true,
        think: options.think,
        responseLanguage: options.responseLanguage,
        contextSize: options.contextSize,
        voiceMode: options.voiceMode,
        message: aiLogMessageIdentity(options.msg),
        downloads: downloads.map(d => ({
            kind: d.kind,
            fileName: d.fileName,
            mimeType: d.mimeType,
            sizeBytes: d.buffer.length
        })),
    });

    preparedRequest = await prepareUnifiedAiRequestPipeline({
        options,
        config,
        downloads,
        streamMessage,
        controller,
    });
    if (preparedRequest.finishAfterTranscript) return;

    aiLog("debug", "request.messages.collected", {
        requestId: options.requestId,
        provider: providerName(options.provider),
        chatMessages: preparedRequest.chatMessages.length,
        imageCount: preparedRequest.imageCount,
        firstRoundStatus: preparedRequest.firstRoundStatus,
        hasToolInputFiles: !!preparedRequest.toolContext.pythonInputFiles?.length,
    });

    try {
        await runUnifiedAiResponsePipeline({
            options,
            config,
            downloads,
            prepared: preparedRequest,
            streamMessage,
            controller,
        });
        aiLog("success", "request.execute.done", {
            requestId: options.requestId,
            provider: providerName(options.provider),
            duration: aiLogDuration(requestStartedAt),
            responseChars: streamMessage.getText().length,
            mistralLibraryId: preparedRequest?.preparedDocumentRag?.provider === AiProvider.MISTRAL ? preparedRequest.preparedDocumentRag.libraryId : undefined,
        });
        return;
    } catch (e) {
        aiLog("error", "request.execute.failed", {
            requestId: options.requestId,
            provider: providerName(options.provider),
            duration: aiLogDuration(requestStartedAt),
            error: e instanceof Error ? e : String(e),
        });
        throw e;
    }
}

export async function runUnifiedAi(options: UnifiedRunOptions): Promise<void> {
    const startedAt = Date.now();
    const config = snapshotRuntimeConfig();
    options.responseLanguage ??= await resolveAiResponseLanguageForUser(options.msg.from?.id);
    options.contextSize ??= await resolveAiContextSizeForUser(options.msg.from?.id);
    options.voiceMode ??= await resolveAiVoiceModeForUser(options.msg.from?.id);
    const imageOutputMode = await resolveAiImageOutputModeForUser(options.msg.from?.id);
    const requestedAttachmentKinds = await collectRequestedAttachmentKinds(options.msg);

    aiLog("info", "run.start", {
        requestId: options.requestId ?? `pending:${options.msg.chat.id}:${options.msg.message_id}`,
        provider: providerName(options.provider),
        model: snapshotModel(options.provider, config),
        message: aiLogMessageIdentity(options.msg),
        targetMessage: aiLogMessageIdentity(options.targetMessage),
        isGuestMsg: options.isGuestMsg,
        stream: options.stream,
        think: options.think,
        responseLanguage: options.responseLanguage,
        contextSize: options.contextSize,
        voiceMode: options.voiceMode,
        requestedAttachmentKinds: [...requestedAttachmentKinds],
        textChars: options.text.length,
    });

    if (await rejectUnsupportedAttachments(options.provider, snapshotModel(options.provider, config), options.msg, config, requestedAttachmentKinds)) {
        aiLog("warn", "run.rejected.unsupported_attachment", {
            requestId: options.requestId ?? `pending:${options.msg.chat.id}:${options.msg.message_id}`,
            provider: providerName(options.provider),
            requestedAttachmentKinds: [...requestedAttachmentKinds],
        });
        return;
    }

    const cached = await collectCachedMessageAttachments(options.msg);
    aiLog("debug", "run.attachments.cache", {
        attachments: cached.attachments.map(a => ({kind: a.kind, fileName: a.fileName, cachePath: a.cachePath})),
        missing: cached.missing.map(a => ({kind: a.kind, fileName: a.fileName, cachePath: a.cachePath})),
    });
    if (cached.missing.length) {
        await replyToMessage({
            message: options.msg,
            text: Environment.getAttachmentMissingFromCacheText(cached.missing[0].fileName),
        }).catch(logError);
        aiLog("warn", "run.rejected.missing_attachment_cache", {
            requestId: options.requestId ?? `pending:${options.msg.chat.id}:${options.msg.message_id}`,
            missing: cached.missing.map(a => ({kind: a.kind, fileName: a.fileName, cachePath: a.cachePath})),
        });
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    let aiRequestStatus: StoredAiRequestStatus = "running";
    let aiRequestError: string | undefined;
    let responseMessageId: number | undefined;
    const cancel = createAiCancelRequest({
        chatId: options.msg.chat.id,
        fromId: options.msg.from?.id ?? 0,
        provider: providerName(options.provider),
        controller
    });
    options.requestId ??= cancel.id;
    const requestId = options.requestId;
    const streamMessage = new TelegramStreamMessage(
        options.msg,
        cancel.id,
        ifTrue(options.stream),
        options.voiceMode === AI_VOICE_MODE_TRANSCRIPT && hasAudioAttachmentKind(requestedAttachmentKinds)
            ? undefined
            : buildAiRegenerateCallbackData(options.provider, !!options.think),
        options.targetMessage,
        options.provider,
        options.isGuestMsg,
        imageOutputMode
    );
    cancel.onCancel = () => streamMessage.cancel(cancel.provider);
    const queueTarget = resolveAiRequestQueueTarget(options, config, requestedAttachmentKinds);
    aiLog("debug", "run.queue.target", {requestId, target: aiLogProviderTarget(queueTarget), cancelId: cancel.id});
    const aiRequestStartedAt = new Date().toISOString();
    recordAiRequestStart();
    await AiRequestStore.put({
        requestId,
        chatId: options.msg.chat.id,
        messageId: options.msg.message_id,
        fromId: options.msg.from?.id ?? 0,
        provider: options.provider,
        model: snapshotModel(options.provider, config),
        status: "running",
        startedAt: aiRequestStartedAt,
    }).catch(logError);

    try {
        const queueMessage = await streamMessage.start(Environment.waitThinkText);
        responseMessageId = queueMessage.message_id;
        await AiRequestStore.put({
            requestId,
            chatId: options.msg.chat.id,
            messageId: options.msg.message_id,
            responseMessageId,
            fromId: options.msg.from?.id ?? 0,
            provider: options.provider,
            model: snapshotModel(options.provider, config),
            status: "running",
            startedAt: aiRequestStartedAt,
        }).catch(logError);
        setAiCancelMessageId(requestId, queueMessage.message_id);
        aiLog("info", "run.queue.enter", {
            requestId,
            cancelId: cancel.id,
            queueMessageId: queueMessage.message_id,
            target: aiLogProviderTarget(queueTarget),
        });

        await aiProviderRequestQueue.enqueue(queueTarget, {
            signal: controller.signal,
            onPositionChange: async requestsBefore => {
                aiLog("debug", "run.queue.position", {requestId, cancelId: cancel.id, requestsBefore});
                streamMessage.setStatus(Environment.getAiQueueText(options.provider, requestsBefore));
                await streamMessage.flush();
            },
            run: async (): Promise<null> => {
                const queueWaitFinishedAt = Date.now();
                aiLog("info", "run.queue.dequeued", {requestId, cancelId: cancel.id});
                const downloads = attachmentsToDownloadedFiles(cached.attachments);
                aiLog("debug", "run.downloads.ready", {
                    requestId,
                    count: downloads.length,
                    downloads: downloads.map(d => ({
                        kind: d.kind,
                        fileName: d.fileName,
                        mimeType: d.mimeType,
                        path: d.path,
                        sizeBytes: d.buffer.length
                    })),
                });
                try {
                    await executeUnifiedAiRequest(options, config, downloads, controller, streamMessage);
                    aiRequestStatus = "succeeded";
                    aiLog("success", "run.queue.task.done", {
                        requestId,
                        cancelId: cancel.id,
                        duration: aiLogDuration(queueWaitFinishedAt),
                    });
                } finally {
                    cleanupDownloads(downloads);
                    aiLog("debug", "run.downloads.cleaned", {requestId, cancelId: cancel.id, count: downloads.length});
                }
                return null;
            },
        });
    } catch (e) {
        if (controller.signal.aborted || isAbortError(e instanceof Error ? e : String(e))) {
            aiRequestStatus = "aborted";
            aiRequestError = e instanceof Error ? e.message : String(e);
            aiLog("warn", "run.aborted", {requestId, cancelId: cancel.id, duration: aiLogDuration(startedAt), error: e instanceof Error ? e : String(e)});
            streamMessage.replaceText(streamMessage.getText());
            await streamMessage.finish();
        } else {
            aiRequestStatus = "failed";
            aiRequestError = e instanceof Error ? e.message : String(e);
            aiLog("error", "run.failed", {requestId, cancelId: cancel.id, duration: aiLogDuration(startedAt), error: e instanceof Error ? e : String(e)});
            const errorMessage = e instanceof Error ? e.message : String(e);
            await streamMessage.fail(e instanceof Error ? e : String(e));
            try {
                await streamMessage.storeInternalAttachment(await persistErrorArtifactAttachment({
                    provider: options.provider,
                    model: snapshotModel(options.provider, config),
                    message: errorMessage,
                    recoverable: false,
                    chatId: options.msg.chat.id,
                    messageId: options.msg.message_id,
                }));
            } catch (artifactError) {
                logError(artifactError instanceof Error ? artifactError : String(artifactError));
            }
            logError(errorMessage);
        }
    } finally {
        clearTimeout(timeout);
        await AiRequestStore.put({
            requestId,
            chatId: options.msg.chat.id,
            messageId: options.msg.message_id,
            responseMessageId,
            fromId: options.msg.from?.id ?? 0,
            provider: options.provider,
            model: snapshotModel(options.provider, config),
            status: aiRequestStatus,
            startedAt: aiRequestStartedAt,
            finishedAt: new Date().toISOString(),
            error: aiRequestError,
        }).catch(logError);
        recordAiRequestFinish(aiRequestStatus);
        finishAiRequest(requestId);
        aiLog("success", "run.finished", {
            requestId,
            cancelId: cancel.id,
            provider: providerName(options.provider),
            duration: aiLogDuration(startedAt),
            aborted: controller.signal.aborted,
        });
    }
}
