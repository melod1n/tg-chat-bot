import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {mistralAi} from "../index";
import {AiModelCapabilities} from "../model/ai-model-capabilities";

export class MistralGetModel extends Command {
    title = "/mistralGetModel";
    description = "Get current Mistral model";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        await replyToMessage({message: msg, text: `Текущая модель: "${Environment.MISTRAL_MODEL}"`}).catch(logError);
    }

    async getModelCapabilities(): Promise<AiModelCapabilities | null> {
        try {
            const info = await mistralAi.models.retrieve({modelId: Environment.MISTRAL_MODEL});
            console.log(info);

            return {
                vision: {supported: info.capabilities.vision},
                ocr: {supported: info.capabilities.ocr},
                thinking: null,
                tools: {supported: info.capabilities.functionCalling}
            };
        } catch (e) {
            logError(e);
            return null;
        }
    }
}