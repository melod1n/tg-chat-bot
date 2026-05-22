import {isRecord} from "./unified-ai-runner.shared.js";
import type {OpenAIChatMessage, OpenAICompatibleChatMessage} from "./openai-chat-message.js";
import type {ToolCallData} from "./unified-ai-runner.shared.js";

export function responseContentToText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map(part => isRecord(part) && typeof part.text === "string" ? part.text : "")
        .join("");
}

export function openAiResponseMessagesToChatCompletions(messages: OpenAIChatMessage[]): OpenAICompatibleChatMessage[] {
    return messages.map((message): OpenAICompatibleChatMessage => {
        if (message.role === "system") {
            return {role: "system", content: responseContentToText(message.content)};
        }

        if (message.role === "assistant") {
            const text = responseContentToText(message.content);
            return text.length
                ? {role: "assistant", content: text}
                : {role: "assistant", content: null};
        }

        const content = Array.isArray(message.content)
            ? (() => {
                const parts = message.content.map((part): {type: "text"; text: string} | {type: "image_url"; image_url: {url: string}} => {
                    if (isRecord(part) && part.type === "input_image") {
                        return {
                            type: "image_url",
                            image_url: {url: String(part.image_url ?? "")},
                        };
                    }

                    return {
                        type: "text",
                        text: isRecord(part) && typeof part.text === "string" ? part.text : "",
                    };
                });

                return parts.every(part => part.type === "text")
                    ? parts.map(part => part.text).join("")
                    : parts;
            })()
            : message.content;

        return {role: "user", content};
    });
}

export function buildAssistantToolMessage(calls: ToolCallData[], text: string): OpenAICompatibleChatMessage {
    return {
        role: "assistant",
        content: text,
        tool_calls: calls.map(call => ({
            id: call.id,
            type: "function",
            function: {
                name: call.name,
                arguments: call.argumentsText,
            },
        })),
    };
}
