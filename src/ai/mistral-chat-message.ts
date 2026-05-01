export const MistralImageDetail = {
    Low: "low",
    Auto: "auto",
    High: "high",
} as const;
export type MistralImageDetail = OpenEnum<typeof MistralImageDetail>;

declare const __brand: unique symbol;
export type Unrecognized<T> = T & { [__brand]: "unrecognized" };

export type OpenEnum<T extends Readonly<Record<string, string | number>>> =
    | T[keyof T]
    | Unrecognized<T[keyof T] extends number ? number : string>;

export const BuiltInConnectors = {
    WebSearch: "web_search",
    WebSearchPremium: "web_search_premium",
    CodeInterpreter: "code_interpreter",
    ImageGeneration: "image_generation",
    DocumentLibrary: "document_library",
} as const;
export type BuiltInConnectors = OpenEnum<typeof BuiltInConnectors>;

export type MistralTextChunk = {
    type: "text";
    text: string;
};

export type MistralToolReferenceChunk = {
    type: "tool_reference" | undefined;
    tool: BuiltInConnectors | string;
    title: string;
    url?: string | null | undefined;
    favicon?: string | null | undefined;
    description?: string | null | undefined;
};

export type MistralThinkChunk = {
    type: "thinking";
    thinking: Array<MistralToolReferenceChunk | MistralTextChunk>;
    signature?: string | null | undefined;
    closed?: boolean | undefined;
};

export type MistralImageURLChunk = {
    type: "image_url";
    imageUrl: string | {
        url: string;
        detail?: MistralImageDetail | null | undefined;
    };
}

export type MistralContentChunk =
    | MistralTextChunk
    | MistralThinkChunk
    | MistralImageURLChunk

/*
 | (ImageURLChunk & { type: "image_url" })
  | (DocumentURLChunk & { type: "document_url" })
  | (TextChunk & { type: "text" })
  | (ReferenceChunk & { type: "reference" })
  | (FileChunk & { type: "file" })
  | (ThinkChunk & { type: "thinking" })
  | AudioChunk
 */

export type MistralFunctionCall = {
    name: string;
    arguments: AiJsonObject | string;
};

export type MistralToolCall = {
    id?: string | undefined;
    type?: string | undefined;
    function: MistralFunctionCall;
    index?: number | undefined;
};

export type MistralAssistantMessage = {
    role: "assistant";
    content?: string | Array<MistralContentChunk> | null | undefined;
    toolCalls?: Array<MistralToolCall> | null | undefined;
    prefix?: boolean | undefined;
}

export type MistralSystemMessageContentChunks =
    | MistralTextChunk
    | MistralThinkChunk;

export type MistralSystemMessage = {
    role: "system";
    content: string;
}

export type MistralToolMessage = {
    role: "tool";
    content: string | Array<MistralContentChunk> | null;
    toolCallId?: string | null | undefined;
    name?: string | null | undefined;
};

export type MistralUserMessage = {
    role: "user";
    content: string | Array<MistralContentChunk> | null;
};

export type MistralChatMessage =
    | MistralAssistantMessage
    | MistralSystemMessage
    | MistralToolMessage
    | MistralUserMessage
import {AiJsonObject} from "./tool-types";
