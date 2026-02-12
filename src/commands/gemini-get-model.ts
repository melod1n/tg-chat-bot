import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {googleAi} from "../index";
import {AiModelCapabilities} from "../model/ai-model-capabilities";

export class GeminiGetModel extends Command {
    title = "/geminiGetModel";
    description = "Get current Gemini model";

    async execute(msg: Message): Promise<void> {
        await replyToMessage({message: msg, text: `Текущая модель: "${Environment.GEMINI_MODEL}"`}).catch(logError);
    }

    async getModelCapabilities(): Promise<AiModelCapabilities | null> {
        try {
            const info = await googleAi.models.get({model: Environment.GEMINI_MODEL});
            console.log(info);

            return {
                vision: {supported: true},
                ocr: null,
                thinking: {supported: info.thinking},
                tools: null
            };
        } catch (e) {
            logError(e);
            return null;
        }
    }
}