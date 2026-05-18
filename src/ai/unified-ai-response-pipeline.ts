import {AiProvider} from "../model/ai-provider";
import {Environment} from "../common/environment";
import {ifTrue, logError} from "../util/utils";
import {UserRequestPipeline, type UserRequestPipelineState, type UserRequestPipelineStage} from "./user-request-pipeline";
import {getProviderAdapter} from "./provider-adapters";
import type {AiDownloadedFile} from "./telegram-attachments";
import type {TelegramStreamMessage} from "./telegram-stream-message";
import type {PreparedUnifiedAiRequest} from "./unified-ai-request-pipeline";
import type {OpenAIChatMessage} from "./openai-chat-message";
import type {MistralChatMessage} from "./mistral-chat-message";
import type {ChatMessage} from "./chat-messages-types";
import {
    allToolSchemaNames,
    providerName,
    RuntimeConfigSnapshot,
    snapshotModel,
    TELEGRAM_LIMIT,
    UnifiedRunOptions,
} from "./unified-ai-runner.shared";
import {runToolRankStage} from "./tool-rank-stage";
import {runOpenAi} from "./unified-ai-runner.openai";
import {runOllama} from "./unified-ai-runner.ollama";
import {runMistral} from "./unified-ai-runner.mistral";
import {summarizeModelOutput} from "./response-model-output";
import {summarizeToolLoop} from "./tool-loop-summary";
import {persistToolLoopSummaryArtifactAttachment} from "./tool-loop-artifact-store";
import {PipelineFallbackNotifier} from "./user-request-pipeline/fallback-notifier";
import {buildToolRankFallbackTargetDetails} from "./user-request-pipeline/fallback-target-details";
import {
    resolveTextToSpeechProviderForUser,
    sendSynthesizedSpeech,
    speechToOutputAttachmentRecord,
    synthesizeSpeech
} from "./text-to-speech";
import {persistFinalTextArtifactAttachment} from "./final-response-artifact-store";
import {aiLog} from "../logging/ai-logger";

function nowIso(): string {
    return new Date().toISOString();
}

function createResponsePipelineState(options: UnifiedRunOptions): UserRequestPipelineState {
    return {
        requestId: `ai-response:${options.msg.chat.id}:${options.msg.message_id}:${Date.now()}`,
        chatId: options.msg.chat.id,
        messageId: options.msg.message_id,
        replyToMessageId: options.msg.reply_to_message?.message_id,
        fromId: options.msg.from?.id ?? 0,
        receivedAt: nowIso(),
        text: options.text,
        settings: {
            provider: options.provider,
            responseLanguage: options.responseLanguage ?? "default",
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

async function runProviderModelCall(params: {
    options: UnifiedRunOptions;
    config: RuntimeConfigSnapshot;
    downloads: AiDownloadedFile[];
    prepared: PreparedUnifiedAiRequest;
    streamMessage: TelegramStreamMessage;
    signal: AbortSignal;
}): Promise<void> {
    const {options, config, downloads, prepared, streamMessage, signal} = params;
    const preparedDocumentRag = prepared.preparedDocumentRag;
    const documents = preparedDocumentRag?.provider === AiProvider.MISTRAL ? preparedDocumentRag.documents : [];

    aiLog("info", "request.provider.dispatch", {provider: providerName(options.provider)});

    switch (options.provider) {
        case AiProvider.OPENAI:
            await runOpenAi(
                options.msg,
                prepared.chatMessages as OpenAIChatMessage[],
                streamMessage,
                signal,
                options.stream ?? true,
                options.msg,
                config,
                prepared.toolContext,
                downloads,
                preparedDocumentRag?.provider === AiProvider.OPENAI ? preparedDocumentRag : undefined,
            );
            return;
        case AiProvider.OLLAMA:
            if (config.ollamaChatTarget.model?.includes("gpt-oss") && options.think) {
                options.think = "high";
            }

            await runOllama(
                options.msg,
                prepared.chatMessages as ChatMessage[],
                streamMessage,
                signal,
                ifTrue(options.stream),
                options.think ?? false,
                prepared.firstRoundStatus,
                config,
                prepared.toolContext,
                options.contextSize,
            );
            return;
        case AiProvider.MISTRAL:
            await runMistral(
                options.msg,
                prepared.chatMessages as MistralChatMessage[],
                documents,
                streamMessage,
                signal,
                options.stream ?? true,
                prepared.firstRoundStatus,
                config,
                prepared.toolContext,
            );
    }
}

async function synthesizeResponseIfRequested(params: {
    options: UnifiedRunOptions;
    config: RuntimeConfigSnapshot;
    streamMessage: TelegramStreamMessage;
}): Promise<"succeeded" | "skipped" | "failed"> {
    const {options, config, streamMessage} = params;

    if (!options.synthesizeSpeechResponse) return "skipped";
    const text = streamMessage.getText().trim();
    if (!text) return "skipped";

    try {
        if (!options.msg.from?.id) {
            throw new Error(Environment.couldNotIdentifyUserForSpeechToTextText);
        }

        const resolved = await resolveTextToSpeechProviderForUser(options.msg.from.id, options.provider)
            .catch(() => resolveTextToSpeechProviderForUser(options.msg.from!.id));
        const speech = await synthesizeSpeech({provider: resolved.provider, text});
        const sent = await sendSynthesizedSpeech(options.msg, speech);
        streamMessage.recordOutputAttachment(speechToOutputAttachmentRecord(speech, sent.message_id));
        return "succeeded";
    } catch (error) {
        aiLog("error", "text_to_speech.failed", {
            provider: providerName(options.provider),
            model: snapshotModel(options.provider, config),
            error: error instanceof Error ? error.message : String(error),
        });
        return "failed";
    }
}

export async function runUnifiedAiResponsePipeline(params: {
    options: UnifiedRunOptions;
    config: RuntimeConfigSnapshot;
    downloads: AiDownloadedFile[];
    prepared: PreparedUnifiedAiRequest;
    streamMessage: TelegramStreamMessage;
    controller: AbortController;
}): Promise<void> {
    const {options, config, downloads, prepared, streamMessage, controller} = params;
    const state = createResponsePipelineState(options);
    const fallbackNotifier = new PipelineFallbackNotifier(options.msg);
    const adapter = getProviderAdapter(options.provider);
    let selectedToolNames: string[] = [];
    let filteredTools: unknown[] = [];

    const stages: UserRequestPipelineStage[] = [
        {
            name: "audit_start",
            async run() {
                return {
                    stage: "audit_start",
                    status: "succeeded",
                    details: {
                        phase: "ai_response",
                        provider: options.provider,
                        model: snapshotModel(options.provider, config),
                        chatMessages: prepared.chatMessages.length,
                        hasDocumentRag: !!prepared.preparedDocumentRag,
                    },
                };
            },
        },
        {
            name: "tool_rank",
            async run() {
                const availableTools = adapter.rankTools(config, {
                    forCreator: options.msg.from?.id === Environment.CREATOR_ID,
                    vectorStoreIds: prepared.preparedDocumentRag?.provider === AiProvider.OPENAI
                        ? prepared.preparedDocumentRag.vectorStoreIds
                        : [],
                });

                const rankResult = await runToolRankStage({
                    provider: options.provider,
                    model: snapshotModel(options.provider, config),
                    round: state.toolRankDecisions.length,
                    config,
                    availableTools,
                    messages: prepared.chatMessages,
                    streamMessage,
                    signal: controller.signal,
                });

                selectedToolNames = rankResult.selectedToolNames;
                filteredTools = rankResult.filteredTools;
                state.toolRankDecisions.push({
                    provider: options.provider,
                    round: state.toolRankDecisions.length,
                    availableTools: allToolSchemaNames(availableTools),
                    selectedTools: selectedToolNames,
                    usedRanker: rankResult.usedRanker,
                });

                return {
                    stage: "tool_rank",
                    status: "succeeded",
                    details: {
                        selectedTools: selectedToolNames,
                        usedRanker: rankResult.usedRanker,
                        availableTools: allToolSchemaNames(availableTools),
                        toolRankDecision: state.toolRankDecisions.at(-1),
                    },
                };
            },
        },
        {
            name: "filter_tools",
            async run() {
                return {
                    stage: "filter_tools",
                    status: "succeeded",
                    details: {
                        selectedTools: selectedToolNames,
                        filteredToolCount: filteredTools.length,
                    },
                };
            },
        },
        {
            name: "model_call",
            async run() {
                await runProviderModelCall({
                    options,
                    config,
                    downloads,
                    prepared,
                    streamMessage,
                    signal: controller.signal,
                });

                return {
                    stage: "model_call",
                    status: "succeeded",
                    details: {
                        modelOutput: summarizeModelOutput({
                            text: streamMessage.getText(),
                            toolExecutions: streamMessage.getToolExecutions(),
                            outputAttachments: streamMessage.getOutputAttachments(),
                        }),
                    },
                };
            },
        },
        {
            name: "tool_loop",
            async run() {
                const executions = streamMessage.getToolExecutions();
                const outputAttachments = streamMessage.getOutputAttachments();
                const summary = summarizeToolLoop({
                    text: streamMessage.getText(),
                    executions,
                    outputAttachments,
                });
                const persisted = await persistToolLoopSummaryArtifactAttachment({
                    chatId: options.msg.chat.id,
                    messageId: options.msg.message_id,
                    text: streamMessage.getText(),
                    executions,
                    outputAttachments,
                });

                if (persisted) {
                    await streamMessage.storeInternalAttachment(persisted);
                }

                return {
                    stage: "tool_loop",
                    ...summary,
                    details: {
                        ...summary.details,
                        persistedSummaryArtifact: !!persisted,
                    },
                };
            },
        },
        {
            name: "output_size_gate",
            async run() {
                const originalChars = streamMessage.getText().length;
                if (originalChars > TELEGRAM_LIMIT) {
                    streamMessage.replaceText(streamMessage.getText().slice(0, TELEGRAM_LIMIT - 3) + "...");
                }

                return {
                    stage: "output_size_gate",
                    status: originalChars > TELEGRAM_LIMIT ? "fallback" : "succeeded",
                    fallbackAction: originalChars > TELEGRAM_LIMIT ? "notify_user" : undefined,
                };
            },
        },
        {
            name: "send_response",
            async run() {
                await streamMessage.finish();
                return {
                    stage: "send_response",
                    status: "succeeded",
                };
            },
        },
        {
            name: "persist_output_artifacts",
            async run() {
                const outputAttachments = streamMessage.getOutputAttachments();
                const artifact = await persistFinalTextArtifactAttachment({
                    provider: options.provider,
                    model: snapshotModel(options.provider, config),
                    text: streamMessage.getText(),
                    chatId: options.msg.chat.id,
                    messageId: options.msg.message_id,
                });

                if (artifact) {
                    await streamMessage.storeInternalAttachment(artifact);
                }

                return {
                    stage: "persist_output_artifacts",
                    status: artifact || outputAttachments.length ? "succeeded" : "skipped",
                    details: {
                        finalTextPersisted: !!artifact,
                        outputAttachments,
                    },
                };
            },
        },
        {
            name: "text_to_speech",
            async run() {
                const status = await synthesizeResponseIfRequested({options, config, streamMessage});
                return {
                    stage: "text_to_speech",
                    status,
                    fallbackAction: status === "failed" ? "continue_without_stage" : undefined,
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
                        phase: "ai_response",
                        textChars: streamMessage.getText().length,
                        toolExecutions: streamMessage.getToolExecutions().length,
                        outputAttachments: streamMessage.getOutputAttachments().length,
                    },
                };
            },
        },
    ];

    const responsePipeline = new UserRequestPipeline({
        stages,
        stageNames: [
            "audit_start",
            "tool_rank",
            "filter_tools",
            "model_call",
            "tool_loop",
            "output_size_gate",
            "send_response",
            "text_to_speech",
            "persist_output_artifacts",
            "audit_finish",
        ],
        onFallback: async decision => {
            if (decision.action === "use_alternate_target") {
                aiLog("warn", "response.fallback.use_alternate_target", {
                    provider: options.provider,
                    stage: decision.stage,
                    reason: decision.reason,
                    ...buildToolRankFallbackTargetDetails(options.provider, config),
                });
            }

            if (decision.action === "fail_request") {
                aiLog("error", "response.fallback.fail_request", {
                    provider: options.provider,
                    stage: decision.stage,
                    reason: decision.reason,
                });
            }

            const notification = await fallbackNotifier.notify(state.requestId, decision);
            state.audit.push({
                stage: decision.stage,
                status: "fallback",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
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

    try {
        await responsePipeline.run(state, controller.signal);
        await streamMessage.storePipelineAudit(state.audit);
    } catch (error) {
        await streamMessage.storePipelineAudit(state.audit).catch(logError);
        throw error;
    } finally {
        const cleanupState = createResponsePipelineState(options);
        const cleanupPipeline = new UserRequestPipeline({
            stages: [{
                name: "cleanup",
                async run() {
                    await prepared.cleanup();
                    return {
                        stage: "cleanup",
                        status: "succeeded",
                    };
                },
            }],
            stageNames: ["cleanup"],
        });

        try {
            await cleanupPipeline.run(cleanupState, controller.signal);
            await streamMessage.storePipelineAudit(cleanupState.audit);
        } catch (error) {
            await streamMessage.storePipelineAudit(cleanupState.audit).catch(logError);
            logError(error instanceof Error ? error : String(error));
        }
    }
}
