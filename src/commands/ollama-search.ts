import {ChatCommand} from "../base/chat-command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {bot, ollama} from "../index";
import {WebSearchResponse} from "../model/web-search-response";
import {editMessageText} from "../util/utils";
import {Environment} from "../common/environment";

export class OllamaSearch extends ChatCommand {
    regexp = /^\/(s|search)\s([^]+)/;
    title = "/search";
    description = "Web search via Ollama";

    override requirements = Requirements.Build(Requirement.BOT_ADMIN);

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        console.log("match", match);
        const chatId = msg.chat.id;

        try {
            const wait = await bot.sendMessage({
                chat_id: chatId,
                text: Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                },
                parse_mode: "Markdown"
            });

            const results = await ollama.webSearch({query: match?.[1]});
            console.log("results", results);

            let message = "Результаты:\n\n";
            results.results.forEach((result, index) => {
                const r = result as WebSearchResponse;
                message += `${index + 1}. ${r.url}\n`;
            });

            await editMessageText(chatId, wait.message_id, message);
        } catch (error) {
            console.error(error);
        }
        return Promise.resolve();
    }
}