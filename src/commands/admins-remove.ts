import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {fullName, logError, oldSendMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {botUser} from "../index";

export class AdminsRemove extends Command {
    command = "removeAdmin";
    title = "/removeAdmin";
    description = "Remove user from admins";

    requirements = Requirements.Build(
        Requirement.BOT_CREATOR,
        Requirement.REPLY,
        Requirement.CHAT,
    );

    async execute(msg: Message): Promise<void> {
        if (!msg.reply_to_message) return;

        const id = msg.reply_to_message.from.id;
        const text = fullName(msg.reply_to_message.from);

        if (id === botUser.id) {
            await oldSendMessage(msg, "Бот не может сам себя убрать из админов").catch(logError);
            return;
        }

        if (id === Environment.CREATOR_ID) {
            await oldSendMessage(msg, "Создатель бота не может перестать быть админом").catch(logError);
            return;
        }

        if (await Environment.removeAdmin(id)) {
            await oldSendMessage(msg, text + " больше не админ!").catch(logError);
        } else {
            await oldSendMessage(msg, text + " и так не был админом 🤔").catch(logError);
        }
    }
}