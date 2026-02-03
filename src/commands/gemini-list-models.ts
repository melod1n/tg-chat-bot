import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {googleAi} from "../index";
import {logError, replyToMessage} from "../util/utils";

export class GeminiListModels extends Command {
    title = "/geminiListModels";
    description = "List all Gemini models";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        try {
            const listResponse = await googleAi.models.list();
            console.log(listResponse);

            const modelsString = listResponse.page
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(e => `${e.name}`)
                .join("\n");

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