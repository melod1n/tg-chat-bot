import {AiProvider} from "../model/ai-provider.js";
import type {BoundaryValue} from "../common/boundary-types.js";
import type {RuntimeConfigSnapshot, ToolCallData} from "./unified-ai-runner.shared.js";
import {getMistralTools, getOllamaTools, getOpenAIResponsesTools, getOpenAICodeInterpreterTool} from "./tool-mappers.js";
import type {MistralChatMessage as MistralMessageType} from "./mistral-chat-message.js";
import type {OpenAIChatMessage as OpenAiMessageType} from "./openai-chat-message.js";
import type {Message as OllamaMessage} from "ollama";
import {
    extractMistralTextDelta,
    extractMistralToolCalls,
    extractOllamaTextDelta,
    extractOllamaToolCalls,
    extractOpenAiTextDelta,
    extractOpenAiStreamingToolCalls,
    extractOpenAiToolCalls,
} from "./provider-adapter-contract.js";

export type ProviderRankToolOptions = {
    forCreator?: boolean;
    vectorStoreIds?: string[];
};

export interface AiProviderAdapter {
    readonly provider: AiProvider;
    mapMessages(messages: readonly unknown[]): unknown[];
    rankTools(config: RuntimeConfigSnapshot, options?: ProviderRankToolOptions): readonly BoundaryValue[];
    callModel<T>(request: unknown, execute: () => Promise<T>): Promise<T>;
    extractTextDelta(input: unknown): string;
    extractToolCalls(input: unknown): ToolCallData[];
    extractStreamingToolCalls(input: unknown): ToolCallData[];
    appendToolResults(messages: unknown[], calls: ToolCallData[], results: string[]): void;
    finalize(): Promise<void>;
}

function appendOllamaToolResults(messages: unknown[], calls: ToolCallData[], results: string[]): void {
    for (const [index, call] of calls.entries()) {
        messages.push({
            role: "tool",
            content: results[index] ?? "",
            tool_name: call.name,
        });
    }
}

class OpenAiProviderAdapter implements AiProviderAdapter {
    readonly provider = AiProvider.OPENAI;

    mapMessages(messages: readonly unknown[]): unknown[] {
        return messages as OpenAiMessageType[];
    }

    rankTools(config: RuntimeConfigSnapshot, options?: ProviderRankToolOptions): readonly BoundaryValue[] {
        const tools: BoundaryValue[] = [
            ...getOpenAIResponsesTools(options?.forCreator) as BoundaryValue[],
            getOpenAICodeInterpreterTool() as BoundaryValue,
            {
                type: "image_generation",
                model: config.openAiImageTarget.model,
                size: "auto",
                moderation: "low",
                output_format: "png",
                partial_images: 3,
            },
            {type: "web_search"},
        ];

        if (options?.vectorStoreIds?.length) {
            tools.unshift({
                type: "file_search",
                vector_store_ids: options.vectorStoreIds,
            });
        }

        return tools;
    }

    async callModel<T>(_request: unknown, execute: () => Promise<T>): Promise<T> {
        return execute();
    }

    extractTextDelta(input: unknown): string {
        return extractOpenAiTextDelta(input);
    }

    extractToolCalls(input: unknown): ToolCallData[] {
        return extractOpenAiToolCalls(input);
    }

    extractStreamingToolCalls(input: unknown): ToolCallData[] {
        return extractOpenAiStreamingToolCalls(input);
    }

    appendToolResults(messages: unknown[], calls: ToolCallData[], results: string[]): void {
        for (const [index, call] of calls.entries()) {
            messages.push({
                type: "function_call_output",
                call_id: call.id,
                output: results[index] ?? "",
            });
        }
    }

    async finalize(): Promise<void> {
        return;
    }
}

class MistralProviderAdapter implements AiProviderAdapter {
    readonly provider = AiProvider.MISTRAL;

    mapMessages(messages: readonly unknown[]): unknown[] {
        return messages as MistralMessageType[];
    }

    rankTools(_config: RuntimeConfigSnapshot, options?: ProviderRankToolOptions): readonly BoundaryValue[] {
        return getMistralTools(options?.forCreator) as BoundaryValue[];
    }

    async callModel<T>(_request: unknown, execute: () => Promise<T>): Promise<T> {
        return execute();
    }

    extractTextDelta(input: unknown): string {
        return extractMistralTextDelta(input);
    }

    extractToolCalls(input: unknown): ToolCallData[] {
        return extractMistralToolCalls(input);
    }

    extractStreamingToolCalls(input: unknown): ToolCallData[] {
        return this.extractToolCalls(input);
    }

    appendToolResults(messages: unknown[], calls: ToolCallData[], results: string[]): void {
        for (const [index, call] of calls.entries()) {
            messages.push({
                role: "tool",
                name: call.name,
                toolCallId: call.id,
                content: results[index] ?? "",
            });
        }
    }

    async finalize(): Promise<void> {
        return;
    }
}

class OllamaProviderAdapter implements AiProviderAdapter {
    readonly provider = AiProvider.OLLAMA;

    mapMessages(messages: readonly unknown[]): unknown[] {
        return messages as OllamaMessage[];
    }

    rankTools(_config: RuntimeConfigSnapshot, options?: ProviderRankToolOptions): readonly BoundaryValue[] {
        return getOllamaTools(options?.forCreator) as BoundaryValue[];
    }

    async callModel<T>(_request: unknown, execute: () => Promise<T>): Promise<T> {
        return execute();
    }

    extractTextDelta(input: unknown): string {
        return extractOllamaTextDelta(input);
    }

    extractToolCalls(input: unknown): ToolCallData[] {
        return extractOllamaToolCalls(input);
    }

    extractStreamingToolCalls(input: unknown): ToolCallData[] {
        return this.extractToolCalls(input);
    }

    appendToolResults(messages: unknown[], calls: ToolCallData[], results: string[]): void {
        appendOllamaToolResults(messages, calls, results);
    }

    async finalize(): Promise<void> {
        return;
    }
}

export function getProviderAdapter(provider: AiProvider): AiProviderAdapter {
    switch (provider) {
        case AiProvider.OPENAI:
            return new OpenAiProviderAdapter();
        case AiProvider.MISTRAL:
            return new MistralProviderAdapter();
        case AiProvider.OLLAMA:
            return new OllamaProviderAdapter();
    }
}
