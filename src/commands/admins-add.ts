import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {fullName, logError, oldSendMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {botUser} from "../index";

export class AdminsAdd extends ChatCommand {
    regexp = /^\/addadmin/i;
    title = "/addAdmin";
    description = "Add user to admins";

    requirements = Requirements.Build(
        Requirement.BOT_CREATOR,
        Requirement.REPLY,
        Requirement.CHAT
    );

    async execute(msg: Message): Promise<void> {
        if (!msg.reply_to_message) return;

        const id = msg.reply_to_message.from.id;
        const text = fullName(msg.reply_to_message.from);

        if (id === botUser.id) {
            await oldSendMessage(msg, "Бот не может сам себя сделать админом").catch(logError);
            return;
        }

        if (id === Environment.CREATOR_ID) {
            await oldSendMessage(msg, "Создатель бота и так является админом").catch(logError);
            return;
        }

        if (await Environment.addAdmin(id)) {
            await oldSendMessage(msg, text + " теперь админ!").catch(logError);
        } else {
            await oldSendMessage(msg, text + " и так уже админ 🤔").catch(logError);
        }
    }
}