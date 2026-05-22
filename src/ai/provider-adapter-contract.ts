import type {ToolCallData} from "./unified-ai-runner.shared.js";
import type {ResponseStreamEvent} from "openai/resources/responses/responses";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeToolCallId(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function normalizeToolArguments(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value ?? {});
}

function normalizeToolArgumentsChunk(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value);
}

export function extractOpenAiToolCalls(response: unknown): ToolCallData[] {
    const output = isRecord(response) && Array.isArray(response.output) ? response.output : [];

    return output
        .filter(item => isRecord(item) && item.type === "function_call" && (typeof item.call_id === "string" || typeof item.name === "string"))
        .map((item, index) => ({
            id: normalizeToolCallId(item.call_id, `openai_${index}`),
            name: typeof item.name === "string" ? item.name : "",
            argumentsText: normalizeToolArguments(item.arguments),
        }))
        .filter(call => call.name.length > 0);
}

export function extractOpenAiTextDelta(input: unknown): string {
    const event = input as ResponseStreamEvent | undefined;
    return event?.type === "response.output_text.delta" ? event.delta ?? "" : "";
}

export function extractOpenAiChatTextDelta(input: unknown): string {
    const event = isRecord(input) ? input : undefined;
    const choice = event && Array.isArray(event.choices) && isRecord(event.choices[0]) ? event.choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : undefined;
    const content = delta && typeof delta.content === "string" ? delta.content : "";
    return content;
}

export function normalizeStreamingTextDelta(existingText: string, deltaText: string): string {
    if (!deltaText) return "";
    if (!existingText) return deltaText;

    if (deltaText.startsWith(existingText)) {
        return deltaText.slice(existingText.length);
    }

    return deltaText;
}

export function extractOpenAiChatToolCalls(response: unknown): ToolCallData[] {
    const record = isRecord(response) ? response : undefined;
    const choice = record && Array.isArray(record.choices) && isRecord(record.choices[0]) ? record.choices[0] : undefined;
    const message = isRecord(choice?.message) ? choice.message : undefined;
    const toolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];

    return toolCalls
        .filter((item, index) => isRecord(item) && ((typeof item.id === "string") || typeof item.index === "number" || index >= 0))
        .map((item, index) => {
            const call = isRecord(item) ? item : {};
            const fn = isRecord(call.function) ? call.function : undefined;
            const name = typeof fn?.name === "string" ? fn.name : typeof call.name === "string" ? call.name : "";
            return {
                id: normalizeToolCallId(call.id, `openai_chat_${typeof call.index === "number" ? call.index : index}`),
                name,
                argumentsText: normalizeToolArguments(fn?.arguments ?? call.arguments),
            };
        })
        .filter(call => call.name.length > 0);
}

export function extractOpenAiChatStreamingToolCalls(input: unknown): ToolCallData[] {
    const event = isRecord(input) ? input : undefined;
    const choice = event && Array.isArray(event.choices) && isRecord(event.choices[0]) ? event.choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : undefined;
    const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];

    return toolCalls
        .map((item, index) => {
            const call = isRecord(item) ? item : {};
            const fn = isRecord(call.function) ? call.function : undefined;
            const name = typeof fn?.name === "string" ? fn.name : typeof call.name === "string" ? call.name : "";
            return {
                id: normalizeToolCallId(call.id, `openai_chat_${typeof call.index === "number" ? call.index : index}`),
                name,
                argumentsText: normalizeToolArgumentsChunk(fn?.arguments ?? call.arguments),
            };
        })
        .filter(call => call.id.length > 0);
}

export function mergeToolCallChunks(existing: ToolCallData[], chunks: ToolCallData[]): ToolCallData[] {
    const merged = new Map<string, ToolCallData>(existing.map(call => [call.id, {...call}]));

    for (const chunk of chunks) {
        const current = merged.get(chunk.id);
        if (!current) {
            merged.set(chunk.id, {...chunk});
            continue;
        }

        merged.set(chunk.id, {
            id: current.id,
            name: current.name || chunk.name,
            argumentsText: current.argumentsText + (chunk.argumentsText ?? ""),
        });
    }

    return [...merged.values()];
}

export function extractOpenAiStreamingToolCalls(input: unknown): ToolCallData[] {
    const event = input as ResponseStreamEvent | undefined;
    if (event?.type === "response.output_item.added" && isRecord(event.item) && event.item.type === "function_call") {
        return extractOpenAiToolCalls({
            output: [{
                type: "function_call",
                call_id: event.item.call_id ?? event.item.id,
                name: event.item.name,
                arguments: event.item.arguments,
            }],
        });
    }

    return [];
}

export function extractMistralToolCalls(calls: unknown): ToolCallData[] {
    const normalized = Array.isArray(calls)
        ? calls
        : isRecord(calls) && (Array.isArray(calls.toolCalls) || Array.isArray(calls.tool_calls))
            ? (calls.toolCalls ?? calls.tool_calls)
            : [];

    if (!Array.isArray(normalized)) return [];

    return normalized
        .map((item, index) => {
            const call = isRecord(item) ? item : {};
            const fn = isRecord(call.function) ? call.function : undefined;
            const name = typeof fn?.name === "string" ? fn.name : typeof call.name === "string" ? call.name : "";
            return {
                id: normalizeToolCallId(call.id, `mistral_${index}`),
                name,
                argumentsText: normalizeToolArguments(fn?.arguments ?? call.arguments),
            };
        })
        .filter(call => call.name.length > 0);
}

export function extractMistralTextDelta(input: unknown): string {
    const delta = isRecord(input) ? input : {};
    const content = delta.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map(part => isRecord(part) && typeof part.text === "string" ? part.text : "")
            .join("");
    }
    return "";
}

export function extractOllamaToolCalls(calls: unknown): ToolCallData[] {
    const normalized = Array.isArray(calls)
        ? calls
        : isRecord(calls) && Array.isArray(calls.tool_calls)
            ? calls.tool_calls
            : [];

    if (!Array.isArray(normalized)) return [];

    return normalized
        .map((item, index) => {
            const call = isRecord(item) ? item : {};
            const fn = isRecord(call.function) ? call.function : undefined;
            const name = typeof fn?.name === "string" ? fn.name : typeof call.name === "string" ? call.name : "";
            return {
                id: normalizeToolCallId(call.id, `ollama_${index}`),
                name,
                argumentsText: normalizeToolArguments(fn?.arguments ?? call.arguments),
            };
        })
        .filter(call => call.name.length > 0);
}

export function extractOllamaTextDelta(input: unknown): string {
    const chunk = isRecord(input) ? input.message : undefined;
    return isRecord(chunk) && typeof chunk.content === "string" ? chunk.content : "";
}
