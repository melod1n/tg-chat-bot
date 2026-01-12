import {ChatCommand} from "../base/chat-command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {bot, botUser} from "../index";
import {fullName, logError, oldSendMessage, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class Unban extends ChatCommand {
    regexp = /^\/unban/i;
    title = "/unban [reply]";
    description = "unban user from chat";

    requirements = Requirements.Build(
        Requirement.CHAT,
        Requirement.BOT_CHAT_ADMIN,
        Requirement.REPLY,
        Requirement.BOT_ADMIN
    );

    async execute(msg: Message) {
        if (!msg.reply_to_message) return;

        const user = msg.reply_to_message.from;
        const userId = user.id;

        if (userId === botUser.id) {
            await replyToMessage(msg, "Бот и так не в бане сам у себя.").catch(logError);
            return;
        }

        if (userId === Environment.CREATOR_ID) {
            await replyToMessage(msg, "Создатель бота и так не в бане и никогда не будет.").catch(logError);
            return;
        }

        if (msg.from.id !== Environment.CREATOR_ID && Environment.ADMIN_IDS.has(userId)) {
            await replyToMessage(msg, "Админимтраторы бота и так не в бане.").catch(logError);
            return;
        }

        bot.unbanChatMember({chat_id: msg.chat.id, user_id: userId})
            .then(async () => {
                await oldSendMessage(msg, `${fullName(user)} разбанен ⛓️‍💥`).catch(logError);
            })
            .catch(async () => {
                await oldSendMessage(msg, `Не смог разбанить ${fullName(user)} ☹️`).catch(logError);
            });
    }
}