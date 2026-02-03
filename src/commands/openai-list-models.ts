import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {openAi} from "../index";
import {logError, replyToMessage} from "../util/utils";

export class OpenAIListModels extends Command {
    title = "/openAIListModels";
    description = "List all OpenAI models";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        try {
            const listResponse = await openAi.models.list();
            console.log(listResponse);

            const modelsString = listResponse.data
                .map(e => `${e.id}`)
                .sort((a, b) => a.localeCompare(b))
                .join("\n")
                .substring(0, 4000);

            const text = "Доступные модели:\n\n" + "<blockquote expandable>" + modelsString + "</blockquote>";

            await replyToMessage({
                message: msg,
                text: text,
                parse_mode: "HTML"
            });
        } catch (e) {
            logError(e);
            await replyToMessage({message: msg, text: "Не получилось загрузить список моделей"}).catch(logError);
        }
    }
}