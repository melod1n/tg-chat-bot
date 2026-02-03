import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";

export class MistralGetModel extends Command {
    title = "/mistralGetModel";
    description = "Get current Mistral model";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        await replyToMessage({message: msg, text: `Текущая модель: "${Environment.MISTRAL_MODEL}"`}).catch(logError);
    }
}