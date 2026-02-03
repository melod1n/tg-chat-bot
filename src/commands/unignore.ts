import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {fullName, logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {botUser} from "../index";
import {Environment} from "../common/environment";

export class Unignore extends Command {
    title = "/unignore";
    description = "Bot will start responding to the user";
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
            await oldSendMessage(msg, "Бот и так всегда к себе прислушивается").catch(logError);
            return;
        }

        if (id === Environment.CREATOR_ID) {
            await oldSendMessage(msg, "Бот всегда слушает своего создателя").catch(logError);
            return;
        }

        if (await Environment.removeMute(id)) {
            await oldSendMessage(msg, text + " больше не в муте! 🔈").catch(logError);
        } else {
            await oldSendMessage(msg, text + " не был в муте 🤔").catch(logError);
        }
    }
}