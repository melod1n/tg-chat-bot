import {AiProvider} from "../model/ai-provider";
import {Environment} from "../common/environment";
import {ifTrue, logError} from "../util/utils";
import {UserRequestPipeline, type UserRequestPipelineState, type UserRequestPipelineStage} from "./user-request-pipeline";
import type {AiDownloadedFile} from "./telegram-attachments";
import type {TelegramStreamMessage} from "./telegram-stream-message";
import type {PreparedUnifiedAiRequest} from "./unified-ai-request-pipeline";
import type {OpenAIChatMessage} from "./openai-chat-message";
import type {MistralChatMessage} from "./mistral-chat-message";
import type {ChatMessage} from "./chat-messages-types";
import {
    providerName,
    RuntimeConfigSnapshot,
    snapshotModel,
    TELEGRAM_LIMIT,
    UnifiedRunOptions,
} from "./unified-ai-runner.shared";
import {runOpenAi} from "./unified-ai-runner.openai";
import {runOllama} from "./unified-ai-runner.ollama";
import {runMistral} from "./unified-ai-runner.mistral";
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
                };
            },
        },
        {
            name: "tool_loop",
            async run() {
                const executions = streamMessage.getToolExecutions();
                return {
                    stage: "tool_loop",
                    status: executions.length ? "succeeded" : "skipped",
                    fallbackAction: executions.length ? undefined : "continue_without_stage",
                    details: {
                        count: executions.length,
                        tools: executions.map(execution => ({
                            toolName: execution.toolName,
                            callId: execution.callId,
                            resultChars: execution.resultChars,
                        })),
                    },
                    artifacts: executions.length ? [{
                        kind: "tool_result",
                        stage: "tool_loop",
                        createdAt: new Date().toISOString(),
                        toolName: "summary",
                        callId: "tool_loop_summary",
                        resultText: JSON.stringify({
                            count: executions.length,
                            tools: executions.map(execution => ({
                                toolName: execution.toolName,
                                callId: execution.callId,
                                resultChars: execution.resultChars,
                            })),
                        }),
                    }] : undefined,
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
            "model_call",
            "tool_loop",
            "output_size_gate",
            "send_response",
            "text_to_speech",
            "persist_output_artifacts",
            "audit_finish",
        ],
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
