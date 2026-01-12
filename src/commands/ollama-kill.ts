import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {oldSendMessage} from "../util/utils";
import {ollama} from "../index";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";

export class OllamaKill extends ChatCommand {
    regexp = /^\/killollama/i;
    title = "/killOllama";
    description = "dunno, do some shit";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        try {
            ollama.abort();
        } catch (e) {
            console.error(e);
        }

        await oldSendMessage(msg, "Остановил все генерации");
    }
}