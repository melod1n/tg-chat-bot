import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {AiModelCapabilities} from "../model/ai-model-capabilities";

export class OpenAIGetModel extends Command {
    title = "/openAIGetModel";
    description = "Get current OpenAI model";

    async execute(msg: Message): Promise<void> {
        await replyToMessage({message: msg, text: `Текущая модель: "${Environment.OPENAI_MODEL}"`}).catch(logError);
    }

    async getModelCapabilities(): Promise<AiModelCapabilities | null> {
        // TODO: 12/02/2026, Danil Nikolaev: find solution
        try {
            return {
                vision: {supported: true},
                ocr: null,
                thinking: {supported: true},
                tools: {supported: true},
            };
        } catch (e) {
            logError(e);
            return null;
        }
    }
}