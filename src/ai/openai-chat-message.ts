import type {
    ResponseInputMessageContentList,
    ResponseOutputMessage,
} from "openai/resources/responses/responses";

type OpenAIInputChatMessage = {
    type: "message";
    role: "system" | "user";
    content: string | ResponseInputMessageContentList;
};

type OpenAIOutputChatMessage = {
    type: "message";
    role: "assistant";
    content: ResponseOutputMessage["content"];
    phase?: ResponseOutputMessage["phase"];
} & Pick<ResponseOutputMessage, "id" | "status">;

export type OpenAIChatMessage = OpenAIInputChatMessage | OpenAIOutputChatMessage;
