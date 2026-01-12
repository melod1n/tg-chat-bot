import {Message} from "typescript-telegram-bot-api";
import {chatCommandToString, delay, logError, sendMessage} from "../util/utils";
import {ChatCommand} from "../base/chat-command";
import {chatCommands} from "../index";
import {TelegramError} from "typescript-telegram-bot-api/dist/errors";

export class Help implements ChatCommand {
    regexp = /^\/(h|help)/i;
    title = "/help";
    description = "Show list of commands";

    async execute(msg: Message) {
        let text = "Commands:\n\n";

        chatCommands.forEach(c => {
            text += `${chatCommandToString(c)}\n`;
        });

        await sendMessage({chatId: msg.from.id, text: text})
            .then(async () => {
                if (msg.chat.type !== "private") {
                    await sendMessage({message: msg, text: "Отправил команды в ЛС 😎"}).catch(logError);
                }
            })
            .catch(async (e) => {
                if (e instanceof TelegramError) {
                    if (e.response?.error_code === 403) {
                        await sendMessage({
                            message: msg,
                            text: "Не смог отправить команды в ЛС ☹️\nТогда отправлю сюда"
                        }).catch(logError);

                        await delay(1000);
                        await sendMessage({message: msg, text: text}).catch(logError);
                    }
                }
            });
    }
}