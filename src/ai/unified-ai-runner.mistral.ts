import {Environment} from "../common/environment";
import {getMistralTools} from "./tool-mappers";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {ToolRuntimeContext} from "./tools/runtime";
import {MistralChatMessage} from "./mistral-chat-message";
import {createMistralClient} from "./ai-runtime-target";
import {aiLog, aiLogDuration, aiLogProviderTarget, aiLogToolCall} from "../logging/ai-logger";
import {AiProvider} from "../model/ai-provider";
import {ToolRanker} from "./unified-ai-runner.tool-ranker";

import {
    contentFromMistralDelta,
    executeToolBatch,
    MAX_TOOL_ROUNDS,
    MistralDeltaLike,
    MistralDocumentReference,
    mistralToolCalls,
    normalizeMistralToolCalls,
    roundStatus,
    RuntimeConfigSnapshot,
    StreamingToolCallAccumulator,
    ToolCallData,
    ToolExecutionMemory
} from "./unified-ai-runner.shared";
import {Message} from "typescript-telegram-bot-api";
import {filterRankedTools, latestUserTextFromMessages} from "./tool-ranker-pipeline";
import {storeToolRankAudit} from "./tool-rank-audit";

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
    const toolRanker = new ToolRanker(config);
    const availableTools = getMistralTools(msg.from?.id === Environment.CREATOR_ID);
    aiLog("info", "mistral.run.start", {
        stream,
        target: aiLogProviderTarget(config.mistralChatTarget),
        inputMessages: messages.length,
        documents: documents.length,
        hasToolInputFiles: !!toolContext.pythonInputFiles?.length,
    });

    const toolMemory: ToolExecutionMemory = new Map();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const roundStartedAt = Date.now();
        aiLog("debug", "mistral.round.start", {round, messages: messages.length, stream});
        if (signal.aborted) throw new Error("Aborted");

        streamMessage.setStatus(Environment.getSelectingToolsText());
        await streamMessage.flush();
        const toolRankStartedAt = Date.now();
        const toolRankStartedAtIso = new Date().toISOString();
        const rankerSelection = await toolRanker.selectTools({
                provider: AiProvider.MISTRAL,
                userQuery: latestUserTextFromMessages(messages),
                availableTools,
                round,
                signal,
            })
            .catch(async error => {
                streamMessage.clearStatus();
                await streamMessage.flush();
                await storeToolRankAudit({
                    streamMessage,
                    provider: AiProvider.MISTRAL,
                    model: config.mistralChatTarget.model,
                    round,
                    startedAt: toolRankStartedAt,
                    startedAtIso: toolRankStartedAtIso,
                    error,
                });
                throw error;
            });
        streamMessage.clearStatus();
        await streamMessage.flush();
        await storeToolRankAudit({
            streamMessage,
            provider: AiProvider.MISTRAL,
            model: config.mistralChatTarget.model,
            round,
            startedAt: toolRankStartedAt,
            startedAtIso: toolRankStartedAtIso,
            selectedTools: rankerSelection.toolNames,
        });
        const filteredTools = filterRankedTools(availableTools, rankerSelection.toolNames);
        const requestTools = filteredTools.length ? filteredTools : undefined;

        streamMessage.setStatus(roundStatus(round, firstRoundStatus) ?? "");
        await streamMessage.flush();

        if (!stream) {
            const request = {
                model: config.mistralChatTarget.model,
                messages,
                tools: requestTools,
                documents: documents
            } as Parameters<typeof mistralAi.chat.complete>[0];
            const response = await mistralAi.chat.complete(request, {signal});
            const message = response.choices?.[0]?.message;
            const text = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
            streamMessage.append(text);
            const calls = normalizeMistralToolCalls(mistralToolCalls(message));
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
            const toolResults = await executeToolBatch(msg.from?.id, calls, streamMessage, toolContext, toolMemory);
            for (const [index, call] of calls.entries()) {
                messages.push({
                    role: "tool",
                    name: call.name,
                    toolCallId: call.id,
                    content: toolResults[index] ?? "",
                });
            }
            continue;
        }

        const request = {
            model: config.mistralChatTarget.model,
            messages,
            tools: requestTools,
            documents: documents
        } as Parameters<typeof mistralAi.chat.stream>[0];
        const streamResponse = await mistralAi.chat.stream(request, {signal});
        aiLog("debug", "mistral.stream.open", {round});
        let calls: ToolCallData[] = [];
        const roundTextStart = streamMessage.getText().length;
        const toolCallAccumulator = new StreamingToolCallAccumulator("mistral_stream", round);

        for await (const event of streamResponse) {
            if (signal.aborted) throw new Error("Aborted");

            const choice = event.data?.choices?.[0];
            const delta = choice?.delta;
            const mistralDelta = delta as MistralDeltaLike;

            streamMessage.append(contentFromMistralDelta(mistralDelta));

            const rawDeltaCalls = mistralToolCalls(mistralDelta);
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
        const toolResults = await executeToolBatch(msg.from?.id, calls, streamMessage, toolContext, toolMemory);
        for (const [index, call] of calls.entries()) {
            messages.push({
                role: "tool",
                name: call.name,
                toolCallId: call.id,
                content: toolResults[index] ?? "",
            });
        }
    }
}
