import {Message} from "typescript-telegram-bot-api";
import {OpenAI, toFile} from "openai";
import {Environment} from "../common/environment";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {ToolRuntimeContext} from "./tools/runtime";
import {OpenAIChatMessage} from "./openai-chat-message";
import type {
    ResponseCreateParamsNonStreaming,
    ResponseCreateParamsStreaming,
    ResponseInputItem,
    ResponseStreamEvent
} from "openai/resources/responses/responses";
import {createOpenAiClient} from "./ai-runtime-target";
import {aiLog, aiLogDuration, aiLogMessageIdentity, aiLogProviderTarget, aiLogToolCall} from "../logging/ai-logger";

import {
    AsyncIterableStream,
    buildSystemInstruction,
    collectOpenAiResponseCodeInterpreterCalls,
    collectOpenAiResponseImages,
    collectOpenAiResponseText,
    MAX_TOOL_ROUNDS,
    OPENAI_IMAGE_PARTIALS,
    openAiResponseItemCallId,
    OpenAiResponseLike,
    OpenAiResponseOutputItem,
    RuntimeConfigSnapshot,
    safeJsonParseObject,
    showOpenAiGeneratedImage,
    ToolCallData,
    ToolExecutionMemory,
    errorMessage,
    allToolSchemaNames
} from "./unified-ai-runner.shared";
import {executeToolBatchWithAdapter} from "./tool-batch-runner";
import {decideToolLoopContinuation} from "./tool-loop-control";
import {bot} from "../index";
import fs from "node:fs";
import path from "node:path";
import {logError} from "../util/utils";
import {SendFileAttachmentResult, SendFileAttachmentResultSchema} from "./tools/files";
import {DEFAULT_AI_RESPONSE_LANGUAGE} from "../common/user-ai-settings";
import {AiDownloadedFile} from "./telegram-attachments";
import {AiProvider} from "../model/ai-provider";
import {getProviderAdapter} from "./provider-adapters";
import {runToolRankStage} from "./tool-rank-stage";

export async function runOpenAi(
    msg: Message,
    messages: OpenAIChatMessage[],
    streamMessage: TelegramStreamMessage,
    signal: AbortSignal,
    stream: boolean,
    sourceMessage: Message,
    config: RuntimeConfigSnapshot,
    toolContext: ToolRuntimeContext,
    downloads: AiDownloadedFile[] = [],
    documentRag?: OpenAiDocumentRagContext,
): Promise<void> {
    const runnerStartedAt = Date.now();
    const openAi = createOpenAiClient(config.openAiChatTarget);
    const ownsDocumentRag = !documentRag;
    const preparedDocumentRag = documentRag ?? await prepareOpenAiDocumentRag(openAi, downloads.filter(download => download.kind === "document"));
    const adapter = getProviderAdapter(AiProvider.OPENAI);
    let responseInput: Array<ResponseInputItem | OpenAiResponseOutputItem> = adapter.mapMessages(messages) as unknown as Array<ResponseInputItem | OpenAiResponseOutputItem>;
    const availableTools = adapter.rankTools(config, {
        forCreator: msg.from?.id === Environment.CREATOR_ID,
        vectorStoreIds: preparedDocumentRag?.vectorStoreIds ?? [],
    });

    const systemPrompt = buildSystemInstruction(
        config,
        DEFAULT_AI_RESPONSE_LANGUAGE,
        false,
        config.openAiChatTarget.systemPromptAdditions,
    );

    aiLog("info", "openai.run.start", {
        stream,
        target: aiLogProviderTarget(config.openAiChatTarget),
        imageTarget: aiLogProviderTarget(config.openAiImageTarget),
        inputMessages: messages.length,
        sourceMessage: aiLogMessageIdentity(sourceMessage),
        hasToolInputFiles: !!toolContext.pythonInputFiles?.length,
    });

    const toolMemory: ToolExecutionMemory = new Map();

    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const roundStartedAt = Date.now();
            aiLog("debug", "openai.round.start", {round, inputItems: responseInput.length, stream});
            const rankResult = await runToolRankStage({
                provider: AiProvider.OPENAI,
                model: config.openAiChatTarget.model,
                round,
                config,
                availableTools,
                messages,
                streamMessage,
                signal,
            });
            const filteredTools = rankResult.filteredTools;
            const requestTools = preparedDocumentRag?.vectorStoreIds.length
                ? (() => {
                    const tools = [...filteredTools];
                    const hasFileSearch = allToolSchemaNames(tools).includes("file_search");
                    if (!hasFileSearch) {
                        const fileSearchTool = availableTools.find(tool => allToolSchemaNames([tool]).includes("file_search"));
                        if (fileSearchTool) {
                            tools.unshift(fileSearchTool);
                        }
                    }
                    return tools.length ? tools : undefined;
                })()
                : (filteredTools.length ? filteredTools : undefined);

            if (!stream) {
                const request: ResponseCreateParamsNonStreaming = {
                    model: config.openAiChatTarget.model,
                    input: responseInput as ResponseInputItem[],
                    tools: requestTools as ResponseCreateParamsNonStreaming["tools"],
                    instructions: systemPrompt,
                };
                const response = await adapter.callModel(request, () => openAi.responses.create(request, {signal})) as OpenAiResponseLike;

                const responseText = collectOpenAiResponseText(response);
                streamMessage.append(responseText);
                aiLog("debug", "openai.response.received", {
                    round,
                    duration: aiLogDuration(roundStartedAt),
                    textChars: responseText.length,
                    outputItems: response?.output?.length ?? 0,
                });
                const images = collectOpenAiResponseImages(response);
                if (images.length) {
                    await showOpenAiGeneratedImage(
                        streamMessage,
                        sourceMessage,
                        images[images.length - 1],
                        `final_${round}`,
                        Environment.getImageGenDoneText(config.openAiImageTarget.model),
                        true,
                    );
                }

                const codeInterpreterCalls = collectOpenAiResponseCodeInterpreterCalls(response);
                if (codeInterpreterCalls.length) {
                    aiLog("info", "openai.code_interpreter_calls", {
                        round,
                        duration: aiLogDuration(roundStartedAt),
                        calls: codeInterpreterCalls.map(call => ({
                            id: call.id,
                            status: call.status,
                            containerId: call.containerId,
                            codeChars: call.code?.length ?? 0,
                            outputItems: call.outputs.length,
                        })),
                    });
                }

                const calls = adapter.extractToolCalls(response);
                aiLog(calls.length ? "info" : "success", calls.length ? "openai.tool_calls" : "openai.run.done", {
                    round,
                    duration: calls.length ? aiLogDuration(roundStartedAt) : aiLogDuration(runnerStartedAt),
                    calls: calls.map(call => ({
                        id: call.id,
                        name: call.name,
                        arguments: safeJsonParseObject(call.argumentsText)
                    })),
                });
                if (!calls.length) return;

                const toolCalls = calls.map(call => ({
                    id: call.id,
                    name: call.name,
                    argumentsText: call.argumentsText,
                }));
                const toolOutputs: Array<{type: "function_call_output"; call_id: string; output: string}> = [];
                const toolResults = await executeToolBatchWithAdapter({
                    userId: msg.from?.id,
                    toolCalls,
                    streamMessage,
                    toolContext,
                    toolMemory,
                    adapter,
                    appendTargets: [toolOutputs],
                });

                const uploadFilesResult = await tryToUploadFiles(msg, toolResults);
                if (uploadFilesResult.found) {
                    if (!uploadFilesResult.uploaded) {
                        const old = toolOutputs[uploadFilesResult.toolIndex];
                        const callId = old?.call_id;
                        if (uploadFilesResult.toolIndex >= 0) {
                            delete toolOutputs[uploadFilesResult.toolIndex];
                        }
                        if (callId) {
                            toolOutputs.push({
                                type: "function_call_output" as const,
                                call_id: callId,
                                output: "Error: " + uploadFilesResult.error
                            });
                        }
                    }
                }

                const continuation = decideToolLoopContinuation({
                    round,
                    maxRounds: MAX_TOOL_ROUNDS,
                    toolCalls: calls,
                });
                if (!continuation.continue && continuation.reason === "max_rounds_reached") {
                    aiLog("warn", "openai.tool_loop.max_rounds_reached", {
                        round,
                        maxRounds: MAX_TOOL_ROUNDS,
                    });
                }

                responseInput = [...responseInput, ...(response.output ?? []), ...toolOutputs];
                continue;
            }

            let completedResponse: OpenAiResponseLike | null = null;
            const request: ResponseCreateParamsStreaming = {
                model: config.openAiChatTarget.model,
                input: responseInput as ResponseInputItem[],
                stream: true,
                tools: requestTools as ResponseCreateParamsStreaming["tools"],
                parallel_tool_calls: true,
                instructions: systemPrompt
            };
            const response = await adapter.callModel(request, () => openAi.responses.create(request, {signal})) as AsyncIterableStream<ResponseStreamEvent>;

            aiLog("debug", "openai.stream.open", {round});

            let localToolCalls: ToolCallData[] = [];
            for await (const event of response) {
                if (signal.aborted) throw new Error("Aborted");

                switch (event.type) {
                    case "response.output_text.delta":
                        streamMessage.append(adapter.extractTextDelta(event));
                        break;
                    case "response.image_generation_call.in_progress":
                        streamMessage.setStatus(Environment.startingImageGenText);
                        await streamMessage.flush();
                        break;
                    case "response.image_generation_call.generating":
                        streamMessage.setStatus(Environment.imageGenText);
                        await streamMessage.flush();
                        break;
                    case "response.image_generation_call.partial_image": {
                        const iteration = (event.partial_image_index ?? 0) + 1;
                        await showOpenAiGeneratedImage(
                            streamMessage,
                            sourceMessage,
                            event.partial_image_b64,
                            `partial_${round}_${iteration}`,
                            Environment.getPartialImageGenText(iteration, OPENAI_IMAGE_PARTIALS),
                            false,
                        );
                        break;
                    }
                    case "response.image_generation_call.completed":
                        streamMessage.setStatus(Environment.finalizingImageGenText);
                        await streamMessage.flush();
                        break;
                    case "response.file_search_call.in_progress":
                    case "response.file_search_call.searching":
                        streamMessage.setStatus(Environment.getUseToolText(["file_search"]));
                        await streamMessage.flush();
                        break;
                    case "response.file_search_call.completed":
                        streamMessage.clearStatus();
                        await streamMessage.flush();
                        break;
                    case "response.code_interpreter_call.in_progress":
                    case "response.code_interpreter_call.interpreting":
                        streamMessage.setStatus(Environment.getUseToolText(["code_interpreter"]));
                        await streamMessage.flush();
                        break;
                    case "response.code_interpreter_call.completed":
                        streamMessage.clearStatus();
                        await streamMessage.flush();
                        break;
                    case "response.code_interpreter_call_code.delta":
                    case "response.code_interpreter_call_code.done":
                        break;
                    case "response.output_item.added":
                        {
                            const streamedCalls = adapter.extractStreamingToolCalls(event);
                            if (streamedCalls.length) {
                                localToolCalls.push(...streamedCalls);
                            }
                            aiLog("info", "openai.stream.tool_call.added", {
                                round,
                                toolCalls: localToolCalls.map(aiLogToolCall)
                            });
                            streamMessage.setStatus(Environment.getUseToolText(localToolCalls));
                            await streamMessage.flush();
                        }
                        break;
                    case "response.output_item.done":
                        if (event.item.type === "function_call" && event.item.name) {
                            const item = event.item as OpenAiResponseOutputItem & { id?: string };
                            const itemId = openAiResponseItemCallId(item);
                            const index = localToolCalls.findIndex(c => c.id === itemId);
                            if (index !== -1) {
                                localToolCalls.splice(index, 1);
                                if (localToolCalls.length === 0) {
                                    streamMessage.clearStatus();
                                } else {
                                    streamMessage.setStatus(Environment.getUseToolText(localToolCalls));
                                }
                                await streamMessage.flush();
                            }
                        }
                        break;
                    case "response.function_call_arguments.delta":
                        break;
                    case "response.function_call_arguments.done":
                        break;

                    case "response.completed":
                        completedResponse = event.response as OpenAiResponseLike;
                        break;
                    case "response.failed":
                        throw new Error(event.response?.error?.message ?? "OpenAI response failed");
                    case "error":
                        throw new Error(event.message ?? event?.message ?? "OpenAI stream error");
                }
            }

            if (!completedResponse) throw new Error("OpenAI did not return the final response.completed event.");

            aiLog("debug", "openai.stream.completed", {
                round,
                duration: aiLogDuration(roundStartedAt),
                outputItems: completedResponse?.output?.length ?? 0,
            });

            const images = collectOpenAiResponseImages(completedResponse);
            if (images.length) {
                await showOpenAiGeneratedImage(
                    streamMessage,
                    sourceMessage,
                    images[images.length - 1],
                    `final_${round}`,
                    Environment.getImageGenDoneText(config.openAiImageTarget.model),
                    true,
                );
            }

            const codeInterpreterCalls = collectOpenAiResponseCodeInterpreterCalls(completedResponse);
            if (codeInterpreterCalls.length) {
                aiLog("info", "openai.code_interpreter_calls", {
                    round,
                    duration: aiLogDuration(roundStartedAt),
                    calls: codeInterpreterCalls.map(call => ({
                        id: call.id,
                        status: call.status,
                        containerId: call.containerId,
                        codeChars: call.code?.length ?? 0,
                        outputItems: call.outputs.length,
                    })),
                });
            }

            const calls = adapter.extractToolCalls(completedResponse);
            aiLog(calls.length ? "info" : "success", calls.length ? "openai.tool_calls" : "openai.run.done", {
                round,
                duration: calls.length ? aiLogDuration(roundStartedAt) : aiLogDuration(runnerStartedAt),
                calls: calls.map(call => ({
                    id: call.id,
                    name: call.name,
                    arguments: safeJsonParseObject(call.argumentsText)
                })),
            });
            if (!calls.length) return;

            const toolCalls = calls.map(call => ({
                id: call.id,
                name: call.name,
                argumentsText: call.argumentsText,
            }));
            const toolOutputs: Array<{type: "function_call_output"; call_id: string; output: string}> = [];
            const toolResults = await executeToolBatchWithAdapter({
                userId: msg.from?.id,
                toolCalls,
                streamMessage,
                toolContext,
                toolMemory,
                adapter,
                appendTargets: [toolOutputs],
            });

            const uploadFilesResult = await tryToUploadFiles(msg, toolResults);
            if (uploadFilesResult.found) {
                if (!uploadFilesResult.uploaded) {
                    const old = toolOutputs[uploadFilesResult.toolIndex];
                    const callId = old?.call_id;
                    if (uploadFilesResult.toolIndex >= 0) {
                        delete toolOutputs[uploadFilesResult.toolIndex];
                    }
                    if (callId) {
                        toolOutputs.push({
                            type: "function_call_output" as const,
                            call_id: callId,
                            output: "Error: " + uploadFilesResult.error
                        });
                    }
                }
            }

            const continuation = decideToolLoopContinuation({
                round,
                maxRounds: MAX_TOOL_ROUNDS,
                toolCalls: calls,
            });
            if (!continuation.continue && continuation.reason === "max_rounds_reached") {
                aiLog("warn", "openai.tool_loop.max_rounds_reached", {
                    round,
                    maxRounds: MAX_TOOL_ROUNDS,
                });
            }

            responseInput = [...responseInput, ...(completedResponse.output ?? []), ...toolOutputs];
        }
    } finally {
        if (ownsDocumentRag) {
            await preparedDocumentRag?.cleanup().catch(logError);
        }
        await adapter.finalize().catch(logError);
    }
}

export type OpenAiDocumentRagContext = {
    vectorStoreIds: string[];
    uploadedFileIds: string[];
    cleanup: () => Promise<void>;
};

export async function prepareOpenAiDocumentRag(openAi: OpenAI, downloads: AiDownloadedFile[]): Promise<OpenAiDocumentRagContext | undefined> {
    if (!downloads.length) return undefined;

    const vectorStore = await openAi.vectorStores.create({
        name: `tg-chat-bot-${Date.now()}`,
        description: "Temporary document RAG for a single Telegram request.",
        expires_after: {
            anchor: "last_active_at",
            days: 1,
        },
    });

    const uploadedFileIds: string[] = [];

    try {
        for (const download of downloads) {
            const uploaded = await openAi.files.create({
                file: await toFile(download.buffer, download.fileName, {
                    type: download.mimeType ?? "application/octet-stream",
                }),
                purpose: "user_data",
            });
            uploadedFileIds.push(uploaded.id);
        }

        const batch = await openAi.vectorStores.fileBatches.createAndPoll(vectorStore.id, {
            file_ids: uploadedFileIds,
        });

        if (batch.file_counts.failed > 0) {
            throw new Error(`OpenAI file_search failed to index ${batch.file_counts.failed} document(s).`);
        }

        return {
            vectorStoreIds: [vectorStore.id],
            uploadedFileIds,
            cleanup: async () => {
                await cleanupOpenAiDocumentRag(openAi, vectorStore.id, uploadedFileIds);
            },
        };
    } catch (error) {
        await cleanupOpenAiDocumentRag(openAi, vectorStore.id, uploadedFileIds).catch(() => undefined);
        throw error;
    }
}

async function cleanupOpenAiDocumentRag(openAi: OpenAI, vectorStoreId: string, fileIds: string[]): Promise<void> {
    await openAi.vectorStores.delete(vectorStoreId).catch(() => undefined);
    for (const fileId of fileIds) {
        await openAi.files.delete(fileId).catch(() => undefined);
    }
}

async function tryToUploadFiles(
    msg: Message,
    toolResults: string[]
): Promise<
    | { found: false }
    | { found: true, uploaded: true }
    | { found: boolean, uploaded: false, error: string, toolIndex: number }
> {
    let sendFileAttachment: {
        result: SendFileAttachmentResult & { success: true },
        toolIndex: number
    } | null = null;

    let found = false;

    try {
        for (const [index, toolResult] of toolResults.entries()) {
            const raw = JSON.parse(toolResult);
            const res = SendFileAttachmentResultSchema.safeParse(raw);

            if (res.success) {
                found = true;

                if (res.data.success) {
                    sendFileAttachment = {result: res.data, toolIndex: index};
                }
            }
        }

        if (!found) {
            return {found: false};
        }

        const attachmentRoot = Environment.FILE_TOOLS_ROOT_DIR;
        const attachmentPath = attachmentRoot
            ? path.join(
                attachmentRoot,
                String(msg.from?.id),
                sendFileAttachment?.result?.attachment?.relativePath ?? "",
            )
            : "";

        if (!fs.existsSync(attachmentPath)) {
            throw new Error(`Attachment file does not exist: ${attachmentPath}`);
        }

        await bot.sendDocument({
            chat_id: msg.chat.id,
            reply_parameters: {
                message_id: msg.message_id,
            },
            document: fs.createReadStream(attachmentPath),
        });

        return {found: true, uploaded: true};
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        return {
            found: found,
            uploaded: false,
            error: errorMessage(e instanceof Error ? e : String(e)),
            toolIndex: sendFileAttachment?.toolIndex ?? -1
        };
    }
}

// function openAiResponseContentToText(content: string | readonly { text?: string; refusal?: string }[]): string {
//     if (typeof content === "string") return content;
//     if (!Array.isArray(content)) return "";
//     return content.map(part => isRecord(part) ? part.text ?? part.content ?? part.refusal ?? "" : "").join("");
// function openAiResponseMessagesToChatCompletions(messages: OpenAIChatMessage[]): OpenAiCompatibleChatMessage[] {
//     return messages.map((message): OpenAiCompatibleChatMessage => {
//         if (message.role === "system" || message.role === "assistant") {
//             return {
//                 role: message.role,
//                 content: openAiResponseContentToText(message.content),
//             };
//         }
//
//         const content = Array.isArray(message.content)
//             ? message.content.map((part): OpenAiCompatibleContentPart => {
//                 if (isRecord(part) && part.type === "input_image") {
//                     return {
//                         type: "image_url",
//                         image_url: {url: String(part.image_url ?? "")},
//                     };
//                 }
//
//                 return {
//                     type: "text",
//                     text: isRecord(part) && typeof part.text === "string" ? part.text : "",
//                 };
//             })
//             : message.content;
//
//         return {role: "user", content};
//     });
// }
// function normalizeOpenAiChatToolCalls(toolCalls: OpenAiChatToolCallLike[] = []): ToolCallData[] {
//     return toolCalls.map((call, i) => ({
//         id: call.id || `openai_chat_${Date.now()}_${i}`,
//         name: call.function?.name || call.name || "",
//         argumentsText: typeof call.function?.arguments === "string"
//             ? call.function.arguments
//             : JSON.stringify(call.function?.arguments ?? call.arguments ?? {}),
//     })).filter(call => call.name);
// }
// async function appendOpenAiChatToolResults(
//     messages: OpenAiCompatibleChatMessage[],
//     calls: ToolCallData[],
//     results: string[],
// ): Promise<void> {
//     for (const [index, call] of calls.entries()) {
//         messages.push({
//             role: "tool",
//             tool_call_id: call.id,
//             content: results[index] ?? "",
//         });
//     }
// }
