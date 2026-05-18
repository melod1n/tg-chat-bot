// Ollama provider runner extracted from unified-ai-runner.ts.
import * as fs from "node:fs";
import path from "node:path";
import {Environment} from "../common/environment";
import type {BoundaryValue} from "../common/boundary-types";
import {bot, notesDir} from "../index";
import {clamp, logError} from "../util/utils";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {ChatMessage} from "./chat-messages-types";
import {ChatRequest, Tool} from "ollama";
import {ToolRuntimeContext} from "./tools/runtime";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {loadOllamaModel, unloadAllOllamaModels} from "./tools/utils";
import {createOllamaClient} from "./ai-runtime-target";
import {aiLog, aiLogDuration, aiLogMessageIdentity, aiLogProviderTarget, aiLogToolCall} from "../logging/ai-logger";
import {getProviderAdapter} from "./provider-adapters";
import {runToolRankStage} from "./tool-rank-stage";

import {
    allToolSchemaNames,
    dedupeToolCalls,
    DEFAULT_OLLAMA_CONTEXT_SIZE,
    isOllamaModelActive,
    isRecord,
    MAX_OLLAMA_CONTEXT_SIZE,
    MAX_TOOL_ROUNDS,
    MIN_OLLAMA_CONTEXT_SIZE,
    roundStatus,
    RuntimeConfigSnapshot,
    safeJsonParseObject,
    Think,
    ToolCallData,
    ToolExecutionMemory
} from "./unified-ai-runner.shared";
import {executeToolBatchWithAdapter} from "./tool-batch-runner";
import {getToolPrompts} from "./tools/registry";
import {GetNoteFileResult, GetNoteFileResultSchema} from "./tools/notes";
import {getModelCapabilities} from "./provider-model-runtime";
import {AiProvider} from "../model/ai-provider";
import {Message} from "typescript-telegram-bot-api";

export async function runOllama(
    msg: Message,
    messages: ChatMessage[],
    streamMessage: TelegramStreamMessage,
    signal: AbortSignal,
    stream: boolean,
    think: Think,
    firstRoundStatus: string,
    config: RuntimeConfigSnapshot,
    toolContext: ToolRuntimeContext,
    contextSize?: number,
): Promise<void> {
    const runnerStartedAt = Date.now();

    const audioCount = messages.reduce((sum, m) => sum + (m.audioParts?.length || m.audios?.length || 0), 0);
    const videoNoteCount = messages.reduce((sum, m) => sum + (m.videoNotes?.length ?? 0), 0);
    const imageCount = messages.reduce((sum, m) => sum + (m.imageParts?.length || m.images?.length || 0), 0);

    const target = (audioCount || videoNoteCount) ? config.ollamaAudioTarget :
        imageCount ? config.ollamaVisionTarget :
            think ? config.ollamaThinkingTarget : config.ollamaChatTarget;
    const model = target.model;
    aiLog("info", "ollama.run.start", {
        stream,
        think,
        target: aiLogProviderTarget(target),
        requestedContextSize: contextSize,
        message: aiLogMessageIdentity(msg),
        counts: {messages: messages.length, images: imageCount, audio: audioCount, videoNotes: videoNoteCount},
        hasToolInputFiles: !!toolContext.pythonInputFiles?.length,
    });

    const ollama = createOllamaClient(target);
    const modelInfo = await ollama.show({model});
    const modelInfoMap: Record<string, BoundaryValue> = isRecord(modelInfo.model_info) ? modelInfo.model_info : {};
    const contextKey = Object.keys(modelInfoMap).find(k => k.endsWith(".context_length"));
    const rawMaxContextLength = contextKey ? modelInfoMap[contextKey] : undefined;
    const parsedMaxContextLength =
        typeof rawMaxContextLength === "number"
            ? rawMaxContextLength
            : typeof rawMaxContextLength === "string"
                ? Number(rawMaxContextLength)
                : DEFAULT_OLLAMA_CONTEXT_SIZE;

    const maxContextLength = Number.isFinite(parsedMaxContextLength)
        ? parsedMaxContextLength
        : DEFAULT_OLLAMA_CONTEXT_SIZE;

    const context = clamp(
        contextSize === -1 ? MAX_OLLAMA_CONTEXT_SIZE : contextSize ?? DEFAULT_OLLAMA_CONTEXT_SIZE,
        MIN_OLLAMA_CONTEXT_SIZE,
        maxContextLength ?? DEFAULT_OLLAMA_CONTEXT_SIZE
    );
    aiLog("debug", "ollama.context.resolved", {model, contextKey, maxContextLength, context});

    const modelsToLoad = [model];

    try {
        const activeModels = (await ollama.ps()).models.map(m => m.model);
        const oldSet = new Set(activeModels);
        const newSet = new Set(modelsToLoad);

        const added = modelsToLoad.filter(m => !oldSet.has(m));
        const removed = activeModels.filter(m => !newSet.has(m));
        const diff = [...added, ...removed];
        aiLog("debug", "ollama.models.active", {activeModels, requiredModels: modelsToLoad, added, removed});
        if (diff.length) {
            aiLog("info", "ollama.models.unload_extra", {keep: modelsToLoad, diff});
            await unloadAllOllamaModels(ollama, modelsToLoad);
        }
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
    }

    if (!(await isOllamaModelActive(ollama, target))) {
        const loadStartedAt = Date.now();
        aiLog("info", "ollama.model.load.start", {model, context});
        const currentStatus = streamMessage.getStatus();
        streamMessage.setStatus(Environment.getLoadingModelText(model));
        await streamMessage.flush();
        if (await loadOllamaModel(model, ollama, context)) {
            aiLog("success", "ollama.model.load.done", {model, duration: aiLogDuration(loadStartedAt)});
            streamMessage.setStatus(currentStatus ?? Environment.waitThinkText);
            await streamMessage.flush();
        }
    } else {
        aiLog("debug", "ollama.model.already_loaded", {model});
    }

    let interval: ReturnType<typeof setInterval> | null = null;

    if (!stream) {
        let typingInFlight = false;
        const applyTyping = async () => {
            if (typingInFlight) return;
            typingInFlight = true;
            try {
                await enqueueTelegramApiCall(
                    () => bot.sendChatAction({chat_id: msg.chat.id, action: "typing"}),
                    {method: "sendChatAction", chatId: msg.chat.id, chatType: msg.chat.type}
                ).catch(logError);
            } finally {
                typingInFlight = false;
            }
        };

        await applyTyping();
        interval = setInterval(() => {
            applyTyping().catch(logError);
        }, 5000);
    }

    const toolMemory: ToolExecutionMemory = new Map();
    const adapter = getProviderAdapter(AiProvider.OLLAMA);

    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const roundStartedAt = Date.now();
            aiLog("debug", "ollama.round.start", {
                round,
                context,
                messages: messages.length,
                stream,
                think: audioCount ? false : think,
            });

            const request: ChatRequest = {
                model: model,
                messages: messages,
                think: audioCount ? false : think,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    top_k: 40,
                    num_ctx: 16384
                }
            };

            let activeToolNames: string[] = [];
            if ((await getModelCapabilities(AiProvider.OLLAMA, model, "tools"))?.tools?.supported) {
                const availableOllamaTools: Tool[] = adapter.rankTools(config, {forCreator: msg.from?.id === Environment.CREATOR_ID}) as Tool[];

                aiLog("debug", "ollama.tools.available", {
                    round,
                    tools: allToolSchemaNames(availableOllamaTools),
                    rankerEnabled: !!config.ollamaToolRankerTarget,
                });

                const rankResult = await runToolRankStage({
                    provider: AiProvider.OLLAMA,
                    model,
                    round,
                    config,
                    availableTools: availableOllamaTools,
                    messages,
                    streamMessage,
                    signal,
                });

                const filteredTools = [...new Set(rankResult.filteredTools as Tool[])];
                activeToolNames = filteredTools.map(t => t.function.name ?? "");
                if (filteredTools.length > 0) {
                    request.tools = [...filteredTools];
                    request.options = {
                        ...request.options,
                        temperature: 0
                    };

                    const newMessage = messages[messages.length - 1];
                    if (newMessage) {
                        newMessage.content += "\n" + "Suggested tools to call: " + activeToolNames.join(", ");
                    }

                    const systemMessage = messages.find(m => m.role === "system");
                    if (systemMessage) {
                        systemMessage.content += "\n\n" + getToolPrompts(activeToolNames).join("\n\n");
                    }

                    request.model = config.ollamaToolTarget.model;
                } else {
                    delete request.tools;
                }

                aiLog("debug", "ollama.tools.selected", {
                    round,
                    tools: activeToolNames,
                    count: activeToolNames.length,
                    usedRanker: rankResult.usedRanker,
                });
            }

            if (!stream) {
                const response = await adapter.callModel(request, () => ollama.chat({
                    ...request,
                    stream: false
                }));

                const message = response.message;
                const rawContent = message?.content ?? "";

                const nativeCalls = dedupeToolCalls(
                    adapter.extractToolCalls(message),
                );

                const responseText = rawContent;

                // if (looksLikeToolRankerJson(responseText)) {
                //     aiLog("error", "ollama.response.looks_like_tool_ranker_json", {
                //         round,
                //         preview: responseText.slice(0, 800),
                //         target: aiLogProviderTarget(target),
                //     });
                //     throw new Error("Ollama chat model returned tool-ranker JSON. Check that OLLAMA chat target and OLLAMA tools/ranker target are not mixed up.");
                // }

                streamMessage.append(responseText);

                aiLog("debug", "ollama.response.received", {
                    round,
                    duration: aiLogDuration(roundStartedAt),
                    textChars: responseText.length,
                    nativeToolCallCount: nativeCalls.length,
                });

                if (!nativeCalls.length) {
                    aiLog("success", "ollama.run.done", {round, duration: aiLogDuration(runnerStartedAt)});
                    break;
                }

                const calls = adapter.extractToolCalls(message).length ? adapter.extractToolCalls(message) : nativeCalls;

                aiLog("info", "ollama.tool_calls", {
                    round,
                    calls: calls.map(aiLogToolCall),
                });

                messages.push({
                    role: "assistant",
                    content: responseText,
                    tool_calls: calls.map(c => ({
                        function: {
                            name: c.name,
                            arguments: safeJsonParseObject(c.argumentsText),
                        },
                    })),
                });

                await executeToolBatchWithAdapter({
                    userId: msg.from?.id,
                    toolCalls: calls,
                    streamMessage,
                    toolContext,
                    toolMemory,
                    adapter,
                    appendTargets: [messages],
                });

                continue;
            }

            aiLog("debug", "ollama.stream.messages", {
                round,
                messageCount: request.messages?.length ?? 0,
            });
            const response = await adapter.callModel(request, () => ollama.chat({
                ...request,
                stream: true
            }));

            aiLog("debug", "ollama.stream.open", {round});
            const calls: ToolCallData[] = [];
            const roundTextStart = streamMessage.getText().length;
            const abortOllamaResponse = () => response.abort?.();
            signal.addEventListener("abort", abortOllamaResponse, {once: true});
            if (signal.aborted) abortOllamaResponse();
            try {
                for await (const chunk of response) {
                    aiLog("trace", "ollama.stream.chunk", {
                        round,
                        contentPreview: chunk.message.content?.slice(0, 240),
                        hasToolCalls: !!chunk.message.tool_calls?.length,
                        hasThinking: !!chunk.message.thinking,
                    });

                    const localToolCalls: ToolCallData[] = [];

                    localToolCalls.push(...adapter.extractStreamingToolCalls(chunk.message));

                    const newStatus = roundStatus(round, firstRoundStatus, chunk.message.content, localToolCalls, !!chunk.message.thinking);
                    const previousStatus = streamMessage.getStatus();
                    if (newStatus && newStatus !== Environment.waitThinkText) {
                        streamMessage.setStatus(newStatus);
                    } else {
                        streamMessage.clearStatus();
                    }

                    if (streamMessage.getStatus() !== previousStatus && previousStatus && newStatus !== Environment.waitThinkText) {
                        await streamMessage.flush();
                    }

                    if (signal.aborted) {
                        response.abort?.();
                        throw new Error("Aborted");
                    }

                    if (!(chunk.message?.thinking && streamMessage.getStatus() !== Environment.reasoningText)) {
                        streamMessage.append(adapter.extractTextDelta(chunk));
                    }

                    calls.push(...adapter.extractStreamingToolCalls(chunk.message));

                    if (chunk.done) {
                        aiLog("debug", "ollama.stream.done", {
                            round,
                            duration: aiLogDuration(roundStartedAt),
                            textChars: streamMessage.getText().slice(roundTextStart).length,
                            toolCallCount: calls.length,
                        });
                        await streamMessage.flush(streamMessage.regenerateKeyboard(), true);
                    }
                }
            } finally {
                signal.removeEventListener("abort", abortOllamaResponse);
            }

            // const streamedRoundText = streamMessage.getText().slice(roundTextStart);
            // if (!calls.length && looksLikeToolRankerJson(streamedRoundText)) {
            //     streamMessage.replaceText(streamMessage.getText().slice(0, roundTextStart));
            //     aiLog("error", "ollama.response.looks_like_tool_ranker_json", {
            //         round,
            //         preview: streamedRoundText.slice(0, 800),
            //         target: aiLogProviderTarget(target),
            //     });
            //     throw new Error("Ollama chat model returned tool-ranker JSON. Check that OLLAMA chat target and OLLAMA tools/ranker target are not mixed up.");
            // }

            if (!calls.length) {
                aiLog("success", "ollama.run.done", {
                    round,
                    duration: aiLogDuration(runnerStartedAt),
                });

                break;
            }

            calls.splice(0, calls.length, ...dedupeToolCalls(calls));

            aiLog("info", "ollama.tool_calls", {
                round,
                calls: calls.map(aiLogToolCall),
            });

            const roundText = streamMessage.getText().slice(roundTextStart);

            messages.push({
                role: "assistant",
                content: roundText,
                tool_calls: calls.map(c => ({
                    function: {
                        name: c.name,
                        arguments: safeJsonParseObject(c.argumentsText),
                    },
                })),
            });

            const toolResults = await executeToolBatchWithAdapter({
                userId: msg.from?.id,
                toolCalls: calls,
                streamMessage,
                toolContext,
                toolMemory,
                adapter,
                appendTargets: [messages],
            });

            let successGetNoteFileResult: GetNoteFileResult | undefined = undefined;

            for (const toolResult of toolResults) {
                try {
                    const raw = JSON.parse(toolResult);
                    const res = GetNoteFileResultSchema.safeParse(raw);

                    if (res.success && res.data.success) {
                        successGetNoteFileResult = res.data;
                    }
                } catch {
                    // Not every tool result is JSON.
                }
            }

            if (successGetNoteFileResult && "attachment" in successGetNoteFileResult) {
                const attachmentPath = path.join(notesDir, successGetNoteFileResult.attachment.relativePath);
                if (!fs.existsSync(attachmentPath)) {
                    throw new Error(`Attachment file does not exist: ${attachmentPath}`);
                }

                await bot.sendDocument({
                    chat_id: msg.chat.id,
                    reply_parameters: {
                        message_id: msg.message_id,
                    },
                    document: fs.createReadStream(attachmentPath),
                }).catch(logError);
            }

        }
    } finally {
        if (interval) clearInterval(interval);
        await adapter.finalize().catch(() => undefined);
    }
}
