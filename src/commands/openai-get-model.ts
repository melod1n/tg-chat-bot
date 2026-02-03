import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class OpenAIGetModel extends Command {
    title = "/openAIGetModel";
    description = "Get current OpenAI model";

    async execute(msg: Message): Promise<void> {
        await replyToMessage({message: msg, text: `Текущая модель: "${Environment.OPENAI_MODEL}"`}).catch(logError);
    }
}