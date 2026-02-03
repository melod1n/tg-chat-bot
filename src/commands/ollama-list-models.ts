import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {ollama} from "../index";
import {logError, oldReplyToMessage, replyToMessage} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";

export class OllamaListModels extends Command {
    title = "/ollamaListModels";
    description = "List all Ollama models";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        try {
            const listResponse = await ollama.list();
            console.log(listResponse);

            const modelsString = listResponse.models
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(e => `${e.model}`)
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