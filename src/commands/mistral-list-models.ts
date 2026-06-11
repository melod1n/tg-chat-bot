import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {mistralAi} from "../index";
import {logError, oldReplyToMessage, replyToMessage} from "../util/utils";

export class MistralListModels extends Command {
    title = "/mistralListModels";
    description = "List all Mistral models";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        try {
            const listResponse = await mistralAi.models.list();
            console.log(listResponse);

            const modelsString = (listResponse.data as any)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(e => `${e.id}`)
                .join("\n");

            const text = "Доступные модели:\n\n" + "<blockquote expandable>" + modelsString + "</blockquote>";

            await replyToMessage({
                message: msg,
                text: text,
                parse_mode: "HTML"
            });
        } catch (e) {
            logError(e);
            await oldReplyToMessage(msg, "Не получилось загрузить список моделей").catch(logError);
        }
    }
}