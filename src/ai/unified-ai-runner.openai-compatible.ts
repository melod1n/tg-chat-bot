import {Message} from "typescript-telegram-bot-api";
import type {
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
    ChatCompletionTool,
} from "openai/resources/chat/completions";
import {Environment} from "../common/environment.js";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {ToolRuntimeContext} from "./tools/runtime";
import {OpenAIChatMessage, OpenAICompatibleChatMessage} from "./openai-chat-message";
import {createOpenAiClient} from "./ai-runtime-target";
import {aiLog, aiLogDuration, aiLogMessageIdentity, aiLogProviderTarget, aiLogToolCall} from "../logging/ai-logger";
import type {BoundaryValue} from "../common/boundary-types.js";
import {
    AsyncIterableStream,
    buildSystemInstruction,
    MAX_TOOL_ROUNDS,
    OpenAiChatCompletionResponseLike,
    OpenAiChatCompletionStreamChunkLike,
    RuntimeConfigSnapshot,
    safeJsonParseObject,
    ToolCallData,
    ToolExecutionMemory,
} from "./unified-ai-runner.shared";
import {mergeToolCallChunks, normalizeStreamingTextDelta} from "./provider-adapter-contract.js";
import {buildUserMemoryPrompt} from "./tools/user-memory.js";
import {executeToolBatchWithAdapter} from "./tool-batch-runner";
import {decideToolLoopContinuation} from "./tool-loop-control";
import {runToolLoopRounds} from "./tool-loop-runner";
import {runSingleModelRequest} from "./model-call-stage";
import {ensureToolsSelected, getOpenAICompatibleTools} from "./tool-mappers.js";
import {MEMORY_TOOL_NAMES} from "./tools/user-memory.js";
import {logError} from "../util/utils";
import {DEFAULT_AI_RESPONSE_LANGUAGE} from "../common/user-ai-settings";
import {AiDownloadedFile} from "./telegram-attachments";
import {AiProvider} from "../model/ai-provider";
import {getProviderAdapter} from "./provider-adapters";
import {runToolRankStage} from "./tool-rank-stage";
import type {AiProviderAdapter} from "./provider-adapters.js";
import {tryToUploadFiles} from "./openai-upload-files.js";
import {buildAssistantToolMessage, openAiResponseMessagesToChatCompletions} from "./openai-chat-completions.js";

function describeOpenAiCompatibleError(error: unknown): Record<string, unknown> {
    const err = error as {
        message?: unknown;
        status?: unknown;
        code?: unknown;
        type?: unknown;
        error?: unknown;
    } | undefined;

    return {
        errorSummary: typeof err?.message === "string" ? err.message : String(error),
        httpStatus: err?.status,
        errorCode: err?.code,
        errorType: err?.type,
    };
}

async function executeChatCompletionWithOptionalToolFallback<T>(params: {
    openAi: ReturnType<typeof createOpenAiClient>;
    request: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;
    signal: AbortSignal;
    stream: boolean;
}): Promise<T> {
    try {
        return await params.openAi.chat.completions.create(params.request as never, {signal: params.signal}) as T;
    } catch (error) {
        const requestWithTools = params.request as {tools?: unknown[]};
        if (!requestWithTools.tools || !Array.isArray(requestWithTools.tools) || requestWithTools.tools.length === 0) {
            aiLog("error", "openai_compatible.request.failed", {
                stream: params.stream,
                hasTools: false,
                error: describeOpenAiCompatibleError(error),
            });
            throw error;
        }

        aiLog("warn", "openai_compatible.tools.retry_without_tools", {
            stream: params.stream,
            error: describeOpenAiCompatibleError(error),
        });

        const retryRequest = {...params.request} as ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming & {tools?: unknown[]};
        delete retryRequest.tools;

        try {
            return await params.openAi.chat.completions.create(retryRequest as never, {signal: params.signal}) as T;
        } catch (retryError) {
            aiLog("error", "openai_compatible.request.retry_without_tools.failed", {
                stream: params.stream,
                hasTools: true,
                error: describeOpenAiCompatibleError(retryError),
            });
            throw retryError;
        }
    }
}

function makeChatCompletionAdapter(): AiProviderAdapter {
    const baseAdapter = getProviderAdapter(AiProvider.OPENAI);

    return {
        ...baseAdapter,
        callModel: baseAdapter.callModel.bind(baseAdapter),
        mapMessages(messages: readonly unknown[]): unknown[] {
            return openAiResponseMessagesToChatCompletions(messages as OpenAIChatMessage[]);
        },
        rankTools(config: RuntimeConfigSnapshot, options?: {forCreator?: boolean; vectorStoreIds?: string[]}): readonly BoundaryValue[] {
            void config;
            void options?.vectorStoreIds;
            return getOpenAICompatibleTools(options?.forCreator) as BoundaryValue[];
        },
        extractTextDelta(input: unknown): string {
            const chunk = input as OpenAiChatCompletionStreamChunkLike | undefined;
            return chunk?.choices?.[0]?.delta?.content ?? "";
        },
        extractToolCalls(input: unknown): ToolCallData[] {
            const response = input as OpenAiChatCompletionResponseLike | undefined;
            const toolCalls = response?.choices?.[0]?.message?.tool_calls ?? [];

            return toolCalls
                .map((call, index) => ({
                    id: typeof call?.id === "string" && call.id.trim().length > 0 ? call.id : `openai_chat_${index}`,
                    name: typeof call?.function?.name === "string" ? call.function.name : typeof call?.name === "string" ? call.name : "",
                    argumentsText: typeof call?.function?.arguments === "string"
                        ? call.function.arguments
                        : JSON.stringify(call?.function?.arguments ?? call?.arguments ?? {}),
                }))
                .filter(call => call.name.length > 0);
        },
        extractStreamingToolCalls(input: unknown): ToolCallData[] {
            const chunk = input as OpenAiChatCompletionStreamChunkLike | undefined;
            const toolCalls = chunk?.choices?.[0]?.delta?.tool_calls ?? [];

            return toolCalls
                .map((call, index) => ({
                    id: typeof call?.id === "string" && call.id.trim().length > 0
                        ? call.id
                        : `openai_chat_${typeof call?.index === "number" ? call.index : index}`,
                    name: typeof call?.function?.name === "string" ? call.function.name : typeof call?.name === "string" ? call.name : "",
                    argumentsText: typeof call?.function?.arguments === "string"
                        ? call.function.arguments
                        : call?.function?.arguments
                            ? JSON.stringify(call.function.arguments)
                            : typeof call?.arguments === "string"
                                ? call.arguments
                                : "",
                }))
                .filter(call => call.id.length > 0);
        },
        appendToolResults(messages: unknown[], calls: ToolCallData[], results: string[]): void {
            for (const [index, call] of calls.entries()) {
                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: results[index] ?? "",
                });
            }
        },
        finalize: baseAdapter.finalize.bind(baseAdapter),
    };
}

export async function runOpenAiCompatible(
    msg: Message,
    messages: OpenAIChatMessage[],
    streamMessage: TelegramStreamMessage,
    signal: AbortSignal,
    stream: boolean,
    sourceMessage: Message,
    config: RuntimeConfigSnapshot,
    toolContext: ToolRuntimeContext,
    downloads: AiDownloadedFile[] = [],
): Promise<void> {
    void downloads;
    const runnerStartedAt = Date.now();
    const openAi = createOpenAiClient(config.openAiChatTarget);
    const adapter = makeChatCompletionAdapter();
    const systemPrompt = buildSystemInstruction(
        config,
        DEFAULT_AI_RESPONSE_LANGUAGE,
        false,
        config.openAiChatTarget.systemPromptAdditions,
        await buildUserMemoryPrompt(msg.from?.id),
    );
    let conversationMessages = [...openAiResponseMessagesToChatCompletions(messages)];

    if (systemPrompt.trim().length) {
        conversationMessages.unshift({role: "system", content: systemPrompt});
    }

    const availableTools = getOpenAICompatibleTools(msg.from?.id === Environment.CREATOR_ID) as ChatCompletionTool[];

    aiLog("info", "openai_compatible.run.start", {
        stream,
        target: aiLogProviderTarget(config.openAiChatTarget),
        inputMessages: messages.length,
        sourceMessage: aiLogMessageIdentity(sourceMessage),
        hasToolInputFiles: !!toolContext.pythonInputFiles?.length,
        backend: config.openAiBackend,
    });

    const toolMemory: ToolExecutionMemory = new Map();

    try {
        await runToolLoopRounds({
            maxRounds: MAX_TOOL_ROUNDS,
            onRound: async (round) => {
                const roundStartedAt = Date.now();
                aiLog("debug", "openai_compatible.round.start", {round, inputMessages: conversationMessages.length, stream});

                const rankResult = await runToolRankStage({
                    provider: AiProvider.OPENAI,
                    model: config.openAiChatTarget.model,
                    round,
                    config,
                    availableTools: availableTools as readonly BoundaryValue[],
                    messages,
                    streamMessage,
                    signal,
                });

                const requestTools = ensureToolsSelected(
                    availableTools,
                    rankResult.filteredTools as ChatCompletionTool[],
                    MEMORY_TOOL_NAMES,
                );

                if (!stream) {
                    const request: ChatCompletionCreateParamsNonStreaming = {
                        model: config.openAiChatTarget.model,
                        messages: conversationMessages,
                        tools: requestTools.length ? requestTools : undefined,
                    };

                    const response = await runSingleModelRequest({
                        execute: () => adapter.callModel(request, () => executeChatCompletionWithOptionalToolFallback<OpenAiChatCompletionResponseLike>({
                            openAi,
                            request,
                            signal,
                            stream: false,
                        })),
                    }) as OpenAiChatCompletionResponseLike;

                    const message = response.choices?.[0]?.message;
                    const responseText = typeof message?.content === "string" ? message.content : "";
                    streamMessage.append(responseText);
                    aiLog("debug", "openai_compatible.response.received", {
                        round,
                        duration: aiLogDuration(roundStartedAt),
                        textChars: responseText.length,
                        hasToolCalls: !!message?.tool_calls?.length,
                    });

                    const calls = adapter.extractToolCalls(response);
                    aiLog(calls.length ? "info" : "success", calls.length ? "openai_compatible.tool_calls" : "openai_compatible.run.done", {
                        round,
                        duration: calls.length ? aiLogDuration(roundStartedAt) : aiLogDuration(runnerStartedAt),
                        calls: calls.map(call => ({
                            id: call.id,
                            name: call.name,
                            arguments: safeJsonParseObject(call.argumentsText)
                        })),
                    });
                    if (!calls.length) return {shouldContinue: false};

                    const toolCalls = calls.map(call => ({
                        id: call.id,
                        name: call.name,
                        argumentsText: call.argumentsText,
                    }));
                    const toolMessages: OpenAICompatibleChatMessage[] = [];
                    const toolResults = await executeToolBatchWithAdapter({
                        userId: msg.from?.id,
                        toolCalls,
                        streamMessage,
                        toolContext: {
                            ...toolContext,
                            provider: AiProvider.OPENAI,
                            runtimeTarget: config.openAiChatTarget,
                        },
                        toolMemory,
                        adapter,
                        appendTargets: [toolMessages],
                    });

                    const uploadFilesResult = await tryToUploadFiles(msg, toolResults);
                    if (uploadFilesResult.found && !uploadFilesResult.uploaded && uploadFilesResult.toolIndex >= 0) {
                        const toolMessage = toolMessages[uploadFilesResult.toolIndex];
                        if (toolMessage && toolMessage.role === "tool") {
                            toolMessage.content = "Error: " + uploadFilesResult.error;
                        }
                    }

                    const continuation = decideToolLoopContinuation({
                        round,
                        maxRounds: MAX_TOOL_ROUNDS,
                        toolCalls: calls,
                    });
                    if (!continuation.continue && continuation.reason === "max_rounds_reached") {
                        aiLog("warn", "openai_compatible.tool_loop.max_rounds_reached", {
                            round,
                            maxRounds: MAX_TOOL_ROUNDS,
                        });
                    }

                    conversationMessages = [...conversationMessages, buildAssistantToolMessage(calls, responseText), ...toolMessages];
                    return {shouldContinue: true};
                }

                const request: ChatCompletionCreateParamsStreaming = {
                    model: config.openAiChatTarget.model,
                    messages: conversationMessages,
                    stream: true,
                    tools: requestTools.length ? requestTools : undefined,
                };

                const response = await runSingleModelRequest({
                    execute: () => adapter.callModel(request, () => executeChatCompletionWithOptionalToolFallback<AsyncIterableStream<OpenAiChatCompletionStreamChunkLike>>({
                        openAi,
                        request,
                        signal,
                        stream: true,
                    })),
                }) as AsyncIterableStream<OpenAiChatCompletionStreamChunkLike>;

                aiLog("debug", "openai_compatible.stream.open", {round});

                let responseText = "";
                let toolCallState: ToolCallData[] = [];
                for await (const chunk of response) {
                    if (signal.aborted) throw new Error("Aborted");

                    const deltaText = adapter.extractTextDelta(chunk);
                    if (deltaText) {
                        const appendedText = normalizeStreamingTextDelta(responseText, deltaText);
                        responseText += appendedText;
                        streamMessage.append(appendedText);
                    }

                    const streamedCalls = adapter.extractStreamingToolCalls(chunk);
                    if (streamedCalls.length) {
                        toolCallState = mergeToolCallChunks(toolCallState, streamedCalls);
                        const activeCalls = toolCallState.filter(call => call.name.length > 0);
                        aiLog("info", "openai_compatible.stream.tool_call.added", {
                            round,
                            toolCalls: activeCalls.map(aiLogToolCall),
                        });
                        streamMessage.setStatus(Environment.getUseToolText(activeCalls));
                        await streamMessage.flush();
                    }
                }

                const calls = toolCallState.filter(call => call.name.length > 0);
                aiLog(calls.length ? "info" : "success", calls.length ? "openai_compatible.tool_calls" : "openai_compatible.stream.done", {
                    round,
                    duration: aiLogDuration(roundStartedAt),
                    textChars: responseText.length,
                    calls: calls.map(call => ({
                        id: call.id,
                        name: call.name,
                        arguments: safeJsonParseObject(call.argumentsText)
                    })),
                });
                if (!calls.length) return {shouldContinue: false};

                streamMessage.clearStatus();
                await streamMessage.flush();

                const toolMessages: OpenAICompatibleChatMessage[] = [];
                const toolResults = await executeToolBatchWithAdapter({
                    userId: msg.from?.id,
                    toolCalls: calls,
                    streamMessage,
                    toolContext: {
                        ...toolContext,
                        provider: AiProvider.OPENAI,
                        runtimeTarget: config.openAiChatTarget,
                    },
                    toolMemory,
                    adapter,
                    appendTargets: [toolMessages],
                });

                const uploadFilesResult = await tryToUploadFiles(msg, toolResults);
                if (uploadFilesResult.found && !uploadFilesResult.uploaded && uploadFilesResult.toolIndex >= 0) {
                    const toolMessage = toolMessages[uploadFilesResult.toolIndex];
                    if (toolMessage && toolMessage.role === "tool") {
                        toolMessage.content = "Error: " + uploadFilesResult.error;
                    }
                }

                const continuation = decideToolLoopContinuation({
                    round,
                    maxRounds: MAX_TOOL_ROUNDS,
                    toolCalls: calls,
                });
                if (!continuation.continue && continuation.reason === "max_rounds_reached") {
                    aiLog("warn", "openai_compatible.tool_loop.max_rounds_reached", {
                        round,
                        maxRounds: MAX_TOOL_ROUNDS,
                    });
                }

                conversationMessages = [...conversationMessages, buildAssistantToolMessage(calls, responseText), ...toolMessages];
                return {shouldContinue: true};
            },
        });
    } catch (error) {
        aiLog("error", "openai_compatible.run.failed", {
            duration: aiLogDuration(runnerStartedAt),
            error: describeOpenAiCompatibleError(error),
        });
        throw error;
    } finally {
        await adapter.finalize().catch(logError);
    }
}
