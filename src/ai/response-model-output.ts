import type {TelegramOutputAttachmentRecord, TelegramToolExecutionRecord} from "./telegram-stream-message.js";

export type NormalizedModelOutput = {
    text: string;
    toolExecutions: TelegramToolExecutionRecord[];
    outputAttachments: TelegramOutputAttachmentRecord[];
};

export function summarizeModelOutput(params: {
    text: string;
    toolExecutions: readonly TelegramToolExecutionRecord[];
    outputAttachments: readonly TelegramOutputAttachmentRecord[];
}): NormalizedModelOutput {
    return {
        text: params.text.trim(),
        toolExecutions: [...params.toolExecutions],
        outputAttachments: [...params.outputAttachments],
    };
}
