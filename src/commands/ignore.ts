import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {fullName, logError, oldSendMessage} from "../util/utils";
import {botUser} from "../index";
import {Environment} from "../common/environment";

export class Ignore extends Command {
    title = "/ignore";
    description = "Bot will ignore user";

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
        Requirement.CHAT_ADMIN,
        Requirement.BOT_CHAT_ADMIN,
        Requirement.REPLY,
    );

    async execute(msg: Message) {
        if (!msg.reply_to_message) return;

        const id = msg.reply_to_message.from.id;
        const text = fullName(msg.reply_to_message.from);

        if (id === botUser.id) {
            await oldSendMessage(msg, "Бот не может сам себя игнорировать").catch(logError);
            return;
        }

        if (id === Environment.CREATOR_ID) {
            await oldSendMessage(msg, "Бот не будет игнорировать своего создателя").catch(logError);
            return;
        }

        if (await Environment.addMute(id)) {
            await oldSendMessage(msg, text + " в муте! 🔇").catch(logError);
        } else {
            await oldSendMessage(msg, text + " уже в муте 🤔").catch(logError);
        }
    }
}