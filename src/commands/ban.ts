import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {bot, botUser} from "../index";
import {fullName, logError, oldSendMessage, oldReplyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class Ban extends Command {
    title = "/ban [reply]";
    description = "ban user from chat";

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
        Requirement.CHAT_ADMIN,
        Requirement.BOT_CHAT_ADMIN,
        Requirement.REPLY,
    );

    async execute(msg: Message) {
        if (!msg.reply_to_message) return;

        const user = msg.reply_to_message.from;
        const userId = user.id;

        if (userId === botUser.id) {
            await oldReplyToMessage(msg, "Используй /leave").catch(logError);
            return;
        }

        if (userId === Environment.CREATOR_ID) {
            await oldReplyToMessage(msg, "Бот не будет банить своего создателя.").catch(logError);
            return;
        }

        if (msg.from.id !== Environment.CREATOR_ID && Environment.ADMIN_IDS.has(userId)) {
            await oldReplyToMessage(msg, "Бот не будет банить своих администраторов.").catch(logError);
            return;
        }

        bot.banChatMember({chat_id: msg.chat.id, user_id: userId})
            .then(async () => {
                await oldSendMessage(msg, `${fullName(user)} забанен 🚫`).catch(logError);
            })
            .catch(async () => {
                await oldSendMessage(msg, `Не смог забанить ${fullName(user)} ☹️`).catch(logError);
            });
    }
}