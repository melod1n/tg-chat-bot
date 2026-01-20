import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {logError, oldReplyToMessage} from "../util/utils";
import {bot} from "../index";

export class Title extends ChatCommand {
    command = "title";
    argsMode = "required" as const;

    title = "/title";
    description = "Change group title";

    requirements = Requirements.Build(
        Requirement.CHAT,
        Requirement.BOT_ADMIN,
        Requirement.BOT_CHAT_ADMIN
    );

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const title = (match?.[3] ?? "").trim();
        if (title.length === 0) {
            await oldReplyToMessage(msg, "Не нашёл название...").catch(logError);
            return;
        }

        await bot.setChatTitle({chat_id: msg.chat.id, title: title}).catch(logError);
    }
}