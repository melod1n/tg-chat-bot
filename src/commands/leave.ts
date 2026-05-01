import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot} from "../index";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {Environment} from "../common/environment";

export class Leave extends Command {
    title = Environment.commandTitles.leave;
    description = Environment.commandDescriptions.leave;

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
    );

    async execute(msg: Message): Promise<void> {
        await enqueueTelegramApiCall(
            () => bot.leaveChat({chat_id: msg.chat.id}),
            {method: "leaveChat", chatId: msg.chat.id, chatType: msg.chat.type}
        );
    }
}
