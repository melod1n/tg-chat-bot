import {AiToolCall} from "./tool-types";
import {OllamaChatMessage} from "./ollama-chat-message";
import {MistralChatMessage} from "./mistral-chat-message";
import {MessageAudioPart, MessageImagePart} from "../common/message-part";
import {OpenAIChatMessage} from "./openai-chat-message";

export type ChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    images?: string[];
    imageParts?: MessageImagePart[];
    documents?: string[];
    audios?: string[];
    audioParts?: MessageAudioPart[];
    videos?: string[];
    videoNotes?: string[];
    thinking?: string;
    tool_calls?: AiToolCall[];
    tool_name?: string;
}

export function asOllamaChatMessage(message: ChatMessage): OllamaChatMessage {
    return {
        role: message.role,
        content: message.content,
        thinking: message.thinking,
        images: message.images,
        tool_calls: message.tool_calls,
        tool_name: message.tool_name
    };
}

export function asMistralChatMessage(message: ChatMessage): MistralChatMessage {
    return {
        role: message.role,
        content: message.content,
    };
}

// export function asOpenAIChatMessage(message: ChatMessage): OpenAIChatMessage {
//     return {
//
//     }
// }
export type AiChatMessage = OpenAIChatMessage | OllamaChatMessage | MistralChatMessage;
