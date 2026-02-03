import {Message} from "typescript-telegram-bot-api";
import {chatCommandToString, delay, logError, sendMessage} from "../util/utils";
import {Command} from "../base/command";
import {commands} from "../index";
import {TelegramError} from "typescript-telegram-bot-api/dist/errors";

export class Help extends Command {
    command = ["h", "help"];

    title = "/help";
    description = "Show list of commands";

    async execute(msg: Message) {
        let text = "Commands:\n\n";

        commands.forEach(c => {
            text += `${chatCommandToString(c)}\n`;
        });

        await sendMessage({chat_id: msg.from.id, text: text})
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