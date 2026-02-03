import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";
import {logError, replyToMessage} from "../util/utils";

export class OpenAISetModel extends Command {
    argsMode = "required" as const;

    title = "/openAISetModel";
    description = "Set OpenAI model";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        const newModel = match?.[3];
        Environment.setOpenAIModel(newModel || Environment.OPENAI_MODEL);

        const text = newModel ? `Выбрана модель "${newModel}"`
            : `Модель не задана. Будет использоваться стандартная модель "${Environment.OPENAI_MODEL}".`;

        await replyToMessage({message: msg, text: text}).catch(logError);
    }
}