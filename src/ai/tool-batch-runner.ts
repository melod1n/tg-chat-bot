import type {AiProviderAdapter} from "./provider-adapters.js";
import {executeToolBatch, type ToolCallData, type ToolExecutionMemory} from "./unified-ai-runner.shared.js";
import type {TelegramStreamMessage} from "./telegram-stream-message.js";
import type {ToolRuntimeContext} from "./tools/runtime.js";

export async function executeToolBatchWithAdapter(params: {
    userId: number | undefined | null;
    toolCalls: ToolCallData[];
    streamMessage: TelegramStreamMessage;
    toolContext: ToolRuntimeContext;
    toolMemory: ToolExecutionMemory;
    adapter: AiProviderAdapter;
    appendTargets?: unknown[][];
}): Promise<string[]> {
    const results = await executeToolBatch(
        params.userId,
        params.toolCalls,
        params.streamMessage,
        params.toolContext,
        params.toolMemory,
    );

    for (const target of params.appendTargets ?? []) {
        params.adapter.appendToolResults(target, params.toolCalls, results);
    }

    return results;
}
