import type {
    ResponseInputMessageContentList,
    ResponseOutputMessage,
} from "openai/resources/responses/responses";
import type {ChatCompletionMessageParam} from "openai/resources/chat/completions";

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

export type OpenAICompatibleChatMessage = ChatCompletionMessageParam;
