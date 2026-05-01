import {Message} from "typescript-telegram-bot-api";
import {chatCommandToString, delay, logError, sendMessage} from "../util/utils";
import {Command} from "../base/command";
import {commands} from "../index";
import {TelegramError} from "typescript-telegram-bot-api/dist/errors";
import {Environment} from "../common/environment";

export class Help extends Command {
    command = ["h", "help"];

    title = Environment.commandTitles.help;
    description = Environment.commandDescriptions.help;

    async execute(msg: Message) {
        if (!msg.from) return;
        let text = Environment.commandsHeaderText;

        commands.forEach(c => {
            text += `${chatCommandToString(c)}\n`;
        });

        await sendMessage({chat_id: msg.from.id, text: text})
            .then(async () => {
                if (msg.chat.type !== "private") {
                    await sendMessage({message: msg, text: Environment.sentCommandsInDmText}).catch(logError);
                }
            })
            .catch(async (e) => {
                if (e instanceof TelegramError) {
                    if (e.response?.error_code === 403) {
                        await sendMessage({
                            message: msg,
                            text: Environment.couldNotSendCommandsInDmText
                        }).catch(logError);

                        await delay(1000);
                        await sendMessage({message: msg, text: text}).catch(logError);
                    }
                }
            });
    }
}
