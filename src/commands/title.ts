import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {logError, oldReplyToMessage} from "../util/utils";
import {bot} from "../index";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {Environment} from "../common/environment";

export class Title extends Command {
    command = "title";
    argsMode = "required" as const;

    title = Environment.commandTitles.title;
    description = Environment.commandDescriptions.title;

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
        Requirement.CHAT_ADMIN,
        Requirement.BOT_CHAT_ADMIN
    );

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const title = (match?.[3] ?? "").trim();
        if (title.length === 0) {
            await oldReplyToMessage(msg, Environment.titleMissingText).catch(logError);
            return;
        }

        await enqueueTelegramApiCall(
            () => bot.setChatTitle({chat_id: msg.chat.id, title: title}),
            {method: "setChatTitle", chatId: msg.chat.id, chatType: msg.chat.type}
        ).catch(logError);
    }
}
