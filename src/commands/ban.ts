import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {bot, botUser} from "../index";
import {fullName, logError, oldSendMessage, oldReplyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";

export class Ban extends Command {
    title = Environment.commandTitles.ban;
    description = Environment.commandDescriptions.ban;

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
        Requirement.CHAT_ADMIN,
        Requirement.BOT_CHAT_ADMIN,
        Requirement.REPLY,
    );

    async execute(msg: Message) {
        if (!msg.reply_to_message || !msg.from || ! msg.reply_to_message.from) return;

        const user = msg.reply_to_message.from;
        const userId = user.id;

        if (userId === botUser.id) {
            await oldReplyToMessage(msg, Environment.useLeaveCommandText).catch(logError);
            return;
        }

        if (userId === Environment.CREATOR_ID) {
            await oldReplyToMessage(msg, Environment.botWillNotBanCreatorText).catch(logError);
            return;
        }

        if (msg.from.id !== Environment.CREATOR_ID && Environment.ADMIN_IDS.has(userId)) {
            await oldReplyToMessage(msg, Environment.botWillNotBanAdminsText).catch(logError);
            return;
        }

        enqueueTelegramApiCall(
            () => bot.banChatMember({chat_id: msg.chat.id, user_id: userId}),
            {method: "banChatMember", chatId: msg.chat.id, chatType: msg.chat.type}
        )
            .then(async () => {
                await oldSendMessage(msg, Environment.getUserBannedText(fullName(user))).catch(logError);
            })
            .catch(async () => {
                await oldSendMessage(msg, Environment.getUserBanFailedText(fullName(user))).catch(logError);
            });
    }
}
