import {Environment} from "../common/environment";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {ToolRuntimeContext} from "./tools/runtime";
import {MistralChatMessage} from "./mistral-chat-message";
import {createMistralClient} from "./ai-runtime-target";
import {aiLog, aiLogDuration, aiLogProviderTarget, aiLogToolCall} from "../logging/ai-logger";
import {AiProvider} from "../model/ai-provider";
import {getProviderAdapter} from "./provider-adapters";
import {runToolRankStage} from "./tool-rank-stage";

import {
    MAX_TOOL_ROUNDS,
    MistralDocumentReference,
    roundStatus,
    RuntimeConfigSnapshot,
    StreamingToolCallAccumulator,
    ToolCallData,
    ToolExecutionMemory
} from "./unified-ai-runner.shared";
import {executeToolBatchWithAdapter} from "./tool-batch-runner";
import {Message} from "typescript-telegram-bot-api";

export async function runMistral(
    msg: Message,
    messages: MistralChatMessage[],
    documents: MistralDocumentReference[],
    streamMessage: TelegramStreamMessage,
    signal: AbortSignal,
    stream: boolean,
    firstRoundStatus: string,
    config: RuntimeConfigSnapshot,
    toolContext: ToolRuntimeContext,
): Promise<void> {
    const runnerStartedAt = Date.now();
    const mistralAi = createMistralClient(config.mistralChatTarget);
    const adapter = getProviderAdapter(AiProvider.MISTRAL);
    const availableTools = adapter.rankTools(config, {forCreator: msg.from?.id === Environment.CREATOR_ID});
    const requestMessages = adapter.mapMessages([...messages]) as unknown as MistralChatMessage[];
    aiLog("info", "mistral.run.start", {
        stream,
        target: aiLogProviderTarget(config.mistralChatTarget),
        inputMessages: messages.length,
        documents: documents.length,
        hasToolInputFiles: !!toolContext.pythonInputFiles?.length,
    });

    const toolMemory: ToolExecutionMemory = new Map();
    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const roundStartedAt = Date.now();
            aiLog("debug", "mistral.round.start", {round, messages: messages.length, stream});
            if (signal.aborted) throw new Error("Aborted");

            const rankResult = await runToolRankStage({
                provider: AiProvider.MISTRAL,
                model: config.mistralChatTarget.model,
                round,
                config,
                availableTools,
                messages,
                streamMessage,
                signal,
            });
            const filteredTools = rankResult.filteredTools;
            const requestTools = filteredTools.length ? filteredTools : undefined;

            streamMessage.setStatus(roundStatus(round, firstRoundStatus) ?? "");
            await streamMessage.flush();

            if (!stream) {
                const request = {
                    model: config.mistralChatTarget.model,
                    messages: requestMessages,
                    tools: requestTools,
                    documents: documents
                } as Parameters<typeof mistralAi.chat.complete>[0];
                const response = await adapter.callModel(request, () => mistralAi.chat.complete(request, {signal}));
                const message = response.choices?.[0]?.message;
                const text = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
                streamMessage.append(text);
                const calls = adapter.extractToolCalls(message);
                aiLog(calls.length ? "info" : "success", calls.length ? "mistral.tool_calls" : "mistral.run.done", {
                    round,
                    duration: calls.length ? aiLogDuration(roundStartedAt) : aiLogDuration(runnerStartedAt),
                    textChars: text.length,
                    calls: calls.map(aiLogToolCall),
                });
                if (!calls.length) return;
                messages.push({
                    role: "assistant",
                    content: text,
                    toolCalls: calls.map(call => ({
                        id: call.id,
                        function: {name: call.name, arguments: call.argumentsText},
                    })),
                });
                requestMessages.push({
                    role: "assistant",
                    content: text,
                    toolCalls: calls.map(call => ({
                        id: call.id,
                        function: {name: call.name, arguments: call.argumentsText},
                    })),
                });
                await executeToolBatchWithAdapter({
                    userId: msg.from?.id,
                    toolCalls: calls,
                    streamMessage,
                    toolContext,
                    toolMemory,
                    adapter,
                    appendTargets: [messages, requestMessages],
                });
                continue;
            }

            const request = {
                model: config.mistralChatTarget.model,
                messages: requestMessages,
                tools: requestTools,
                documents: documents
            } as Parameters<typeof mistralAi.chat.stream>[0];
            const streamResponse = await adapter.callModel(request, () => mistralAi.chat.stream(request, {signal}));
            aiLog("debug", "mistral.stream.open", {round});
            let calls: ToolCallData[] = [];
            const roundTextStart = streamMessage.getText().length;
            const toolCallAccumulator = new StreamingToolCallAccumulator("mistral_stream", round);

            for await (const event of streamResponse) {
                if (signal.aborted) throw new Error("Aborted");

                const choice = event.data?.choices?.[0];
                const delta = choice?.delta;
                const mistralDelta = delta;
                streamMessage.append(adapter.extractTextDelta(mistralDelta));

                const rawDeltaCalls = adapter.extractStreamingToolCalls(mistralDelta);
                if (rawDeltaCalls.length) {
                    calls = toolCallAccumulator.add(rawDeltaCalls);
                    streamMessage.setStatus(Environment.getUseToolText(calls));
                    await streamMessage.flush();
                }
            }
            aiLog(calls.length ? "info" : "success", calls.length ? "mistral.tool_calls" : "mistral.run.done", {
                round,
                duration: calls.length ? aiLogDuration(roundStartedAt) : aiLogDuration(runnerStartedAt),
                textChars: streamMessage.getText().slice(roundTextStart).length,
                calls: calls.map(aiLogToolCall),
            });
            if (!calls.length) return;
            const roundText = streamMessage.getText().slice(roundTextStart);
            messages.push({
                role: "assistant",
                content: roundText,
                toolCalls: calls.map(c => ({id: c.id, function: {name: c.name, arguments: c.argumentsText}}))
            });
            requestMessages.push({
                role: "assistant",
                content: roundText,
                toolCalls: calls.map(c => ({id: c.id, function: {name: c.name, arguments: c.argumentsText}}))
            });
            await executeToolBatchWithAdapter({
                userId: msg.from?.id,
                toolCalls: calls,
                streamMessage,
                toolContext,
                toolMemory,
                adapter,
                appendTargets: [messages, requestMessages],
            });
        }
    } finally {
        await adapter.finalize().catch(() => undefined);
    }
}
