import {AiProvider} from "../model/ai-provider";
import {AI_VOICE_MODE_TRANSCRIPT, DEFAULT_AI_RESPONSE_LANGUAGE} from "../common/user-ai-settings";
import {Environment} from "../common/environment";
import {UserRequestPipeline, type UserRequestPipelineState, type UserRequestPipelineStage} from "./user-request-pipeline";
import {PipelineFallbackNotifier} from "./user-request-pipeline/fallback-notifier";
import {buildToolRankFallbackTargetDetails} from "./user-request-pipeline/fallback-target-details";
import {mergeReplyChainDownloads, shouldPreferCurrentDownloads} from "./reply-chain-downloads";
import {attachmentsToDownloadedFiles, type AiDownloadedFile} from "./telegram-attachments";
import type {TelegramStreamMessage} from "./telegram-stream-message";
import type {ChatMessage} from "./chat-messages-types";
import type {OpenAIChatMessage} from "./openai-chat-message";
import type {MistralChatMessage} from "./mistral-chat-message";
import type {PreparedDocumentRag} from "./document-rag-pipeline";
import {prepareDocumentRag} from "./document-rag-pipeline";
import {persistRagArtifactAttachment} from "./rag-artifact-store";
import {persistTranscriptArtifactAttachment} from "./transcript-artifact-store";
import type {ToolRuntimeContext} from "./tools/runtime";
import {recordPipelineFallback, recordRagRun} from "../common/ai-observability.js";
import {
    appendTranscriptToChatMessages,
    collectTextMessages,
    initialStatus,
    providerName,
    RuntimeConfigSnapshot,
    stripAudioFromRunnerMessages,
    toolRuntimeContextFromDownloads,
    transcribeAudioIfNeeded,
    collectStoredReplyChainAttachments,
    UnifiedRunOptions,
} from "./unified-ai-runner.shared";
import {aiLog} from "../logging/ai-logger";
import {isTranscribableAudioDownload} from "./speech-to-text";

export type PreparedUnifiedAiRequest = {
    chatMessages: Array<OpenAIChatMessage | MistralChatMessage | ChatMessage>;
    imageCount: number;
    firstRoundStatus: string;
    toolContext: ToolRuntimeContext;
    preparedDocumentRag?: PreparedDocumentRag;
    finishAfterTranscript: boolean;
    cleanup: () => Promise<void>;
};

type MutablePreparedContext = {
    chatMessages: Array<OpenAIChatMessage | MistralChatMessage | ChatMessage>;
    imageCount: number;
    firstRoundStatus: string;
    toolContext: ToolRuntimeContext;
    transcript: string;
    preparedDocumentRag?: PreparedDocumentRag;
    finishAfterTranscript: boolean;
};

function nowIso(): string {
    return new Date().toISOString();
}

function runtimeTargetFor(options: UnifiedRunOptions, config: RuntimeConfigSnapshot) {
    return options.provider === AiProvider.OLLAMA
        ? config.ollamaChatTarget
        : options.provider === AiProvider.MISTRAL
            ? config.mistralChatTarget
            : config.openAiChatTarget;
}

function createAiRequestPipelineState(options: UnifiedRunOptions): UserRequestPipelineState {
    return {
        requestId: options.requestId ?? `ai:${options.msg.chat.id}:${options.msg.message_id}:${Date.now()}`,
        chatId: options.msg.chat.id,
        messageId: options.msg.message_id,
        replyToMessageId: options.msg.reply_to_message?.message_id,
        fromId: options.msg.from?.id ?? 0,
        receivedAt: nowIso(),
        text: options.text,
        settings: {
            provider: options.provider,
            responseLanguage: options.responseLanguage ?? DEFAULT_AI_RESPONSE_LANGUAGE,
            contextSize: options.contextSize,
            voiceMode: options.voiceMode ?? "execute",
            imageOutputMode: "photo",
        },
        inputAttachments: [],
        outputAttachments: [],
        artifacts: [],
        toolRankDecisions: [],
        audit: [],
    };
}

export async function prepareUnifiedAiRequestPipeline(params: {
    options: UnifiedRunOptions;
    config: RuntimeConfigSnapshot;
    downloads: AiDownloadedFile[];
    streamMessage: TelegramStreamMessage;
    controller: AbortController;
}): Promise<PreparedUnifiedAiRequest> {
    const {options, config, downloads, streamMessage, controller} = params;
    const replyChainDownloads = shouldPreferCurrentDownloads(options.text, downloads)
        ? downloads
        : mergeReplyChainDownloads(
            downloads,
            attachmentsToDownloadedFiles(await collectStoredReplyChainAttachments(options.msg)),
        );
    const prepared: MutablePreparedContext = {
        chatMessages: [],
        imageCount: 0,
        firstRoundStatus: Environment.waitThinkText,
        toolContext: {},
        transcript: "",
        finishAfterTranscript: false,
    };

    const stages: UserRequestPipelineStage[] = [
        {
            name: "audit_start",
            async run() {
                return {
                    stage: "audit_start",
                    status: "succeeded",
                    details: {
                        phase: "ai_request_prepare",
                        provider: options.provider,
                        downloads: replyChainDownloads.map(download => ({
                            kind: download.kind,
                            fileName: download.fileName,
                            mimeType: download.mimeType,
                            sizeBytes: download.sizeBytes ?? download.buffer.length,
                        })),
                    },
                };
            },
        },
        {
            name: "collect_conversation_context",
            async run() {
                const collected = await collectTextMessages(
                    options.msg,
                    options.text,
                    options.provider,
                    replyChainDownloads,
                    config,
                    runtimeTargetFor(options, config),
                    options.responseLanguage ?? DEFAULT_AI_RESPONSE_LANGUAGE,
                );
                prepared.chatMessages = collected.chatMessages as typeof prepared.chatMessages;
                prepared.imageCount = collected.imageCount;
                prepared.firstRoundStatus = initialStatus(replyChainDownloads, prepared.imageCount);
                prepared.toolContext = toolRuntimeContextFromDownloads(replyChainDownloads);

                return {
                    stage: "collect_conversation_context",
                    status: "succeeded",
                };
            },
        },
        {
            name: "prepare_text_context",
            async run() {
                streamMessage.setStatus(prepared.firstRoundStatus);
                await streamMessage.flush();

                return {
                    stage: "prepare_text_context",
                    status: "succeeded",
                };
            },
        },
        {
            name: "resolve_runtime",
            async run() {
                return {
                    stage: "resolve_runtime",
                    status: "succeeded",
                };
            },
        },
        {
            name: "speech_to_text",
            async run() {
                prepared.transcript = await transcribeAudioIfNeeded(
                    options.provider,
                    options.msg.from?.id,
                    replyChainDownloads,
                    streamMessage,
                    controller.signal,
                ).catch(error => {
                    if (replyChainDownloads.some(isTranscribableAudioDownload)) throw error;
                    return "";
                });

                const transcript = prepared.transcript.trim();
                if (!transcript) {
                    return {
                        stage: "speech_to_text",
                        status: "skipped",
                    };
                }

                const transcriptArtifact = await persistTranscriptArtifactAttachment({
                    provider: options.provider,
                    transcript,
                    downloads: replyChainDownloads,
                    chatId: options.msg.chat.id,
                    messageId: options.msg.message_id,
                });
                if (transcriptArtifact) {
                    await streamMessage.storeInternalAttachment(transcriptArtifact);
                }

                if (options.voiceMode === AI_VOICE_MODE_TRANSCRIPT) {
                    prepared.finishAfterTranscript = true;
                    streamMessage.replaceText(`[Расшифровка]\n${transcript}`);
                    await streamMessage.finish();
                    return {
                        stage: "speech_to_text",
                        status: "succeeded",
                        fallbackAction: "continue_without_stage",
                    };
                }

                appendTranscriptToChatMessages(prepared.chatMessages, transcript);
                stripAudioFromRunnerMessages(prepared.chatMessages);
                aiLog("debug", "request.transcript.appended", {
                    provider: providerName(options.provider),
                    transcriptChars: transcript.length,
                    chatMessages: prepared.chatMessages.length,
                });

                return {
                    stage: "speech_to_text",
                    status: "succeeded",
                };
            },
        },
        {
            name: "document_rag",
            async run() {
                if (prepared.finishAfterTranscript) {
                    return {
                        stage: "document_rag",
                        status: "skipped",
                    };
                }

                prepared.preparedDocumentRag = await prepareDocumentRag(
                    options.provider,
                    replyChainDownloads,
                    prepared.chatMessages,
                    streamMessage,
                    config,
                    controller.signal,
                    options.text,
                );

                const ragArtifact = await persistRagArtifactAttachment({
                    provider: options.provider,
                    prepared: prepared.preparedDocumentRag,
                    downloads: replyChainDownloads,
                    chatId: options.msg.chat.id,
                    messageId: options.msg.message_id,
                    details: prepared.preparedDocumentRag?.provider === AiProvider.OPENAI
                        ? {uploadedFileIds: prepared.preparedDocumentRag.uploadedFileIds}
                        : prepared.preparedDocumentRag?.provider === AiProvider.OLLAMA
                            ? {
                                embeddingModel: config.ollamaDocumentsTarget.model,
                                topK: config.ollamaRagTopK,
                                chunkSize: config.ollamaRagChunkSize,
                                chunkOverlap: config.ollamaRagChunkOverlap,
                                maxContextChars: config.ollamaRagMaxContextChars,
                                artifact: prepared.preparedDocumentRag.artifact,
                            }
                            : undefined,
                });
                if (ragArtifact) {
                    await streamMessage.storeInternalAttachment(ragArtifact);
                }

                if (prepared.preparedDocumentRag) {
                    recordRagRun();
                }

                return {
                    stage: "document_rag",
                    status: prepared.preparedDocumentRag ? "succeeded" : "skipped",
                };
            },
        },
        {
            name: "audit_finish",
            async run() {
                return {
                    stage: "audit_finish",
                    status: "succeeded",
                    details: {
                        phase: "ai_request_prepare",
                        chatMessages: prepared.chatMessages.length,
                        imageCount: prepared.imageCount,
                        hasTranscript: !!prepared.transcript.trim(),
                        hasDocumentRag: !!prepared.preparedDocumentRag,
                        finishAfterTranscript: prepared.finishAfterTranscript,
                    },
                };
            },
        },
    ];

    const state = createAiRequestPipelineState(options);
    const fallbackNotifier = new PipelineFallbackNotifier(options.msg, options.responseLanguage);
    const pipeline = new UserRequestPipeline({
        stages,
        stageNames: [
            "audit_start",
            "collect_conversation_context",
            "prepare_text_context",
            "resolve_runtime",
            "speech_to_text",
            "document_rag",
            "audit_finish",
        ],
        onFallback: async decision => {
            recordPipelineFallback(decision.action);
            if (decision.action === "use_alternate_target") {
                aiLog("warn", "request.fallback.use_alternate_target", {
                    provider: options.provider,
                    stage: decision.stage,
                    reason: decision.reason,
                    requestId: state.requestId,
                    ...buildToolRankFallbackTargetDetails(options.provider, config),
                });
            }

            if (decision.action === "fail_request") {
                aiLog("error", "request.fallback.fail_request", {
                    provider: options.provider,
                    stage: decision.stage,
                    reason: decision.reason,
                    requestId: state.requestId,
                });
            }

            const notification = await fallbackNotifier.notify(state.requestId, decision);
            state.audit.push({
                stage: decision.stage,
                status: "fallback",
                startedAt: nowIso(),
                finishedAt: nowIso(),
                details: {
                    fallbackAction: decision.action,
                    fallbackNotification: notification.text,
                    fallbackNotified: notification.notified,
                    reason: decision.reason,
                    ...(decision.action === "use_alternate_target"
                        ? buildToolRankFallbackTargetDetails(options.provider, config)
                        : {}),
                },
            });
        },
    });
    await pipeline.run(state, controller.signal);
    await streamMessage.storePipelineAudit(state.audit);

    return {
        chatMessages: prepared.chatMessages,
        imageCount: prepared.imageCount,
        firstRoundStatus: prepared.firstRoundStatus,
        toolContext: prepared.toolContext,
        preparedDocumentRag: prepared.preparedDocumentRag,
        finishAfterTranscript: prepared.finishAfterTranscript,
        cleanup: async () => {
            await prepared.preparedDocumentRag?.cleanup();
        },
    };
}
