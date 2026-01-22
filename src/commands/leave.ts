import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot} from "../index";

export class Leave extends ChatCommand {
    title = "/leave";
    description = "Bot will leave current chat";

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
        Requirement.CHAT_ADMIN,
        Requirement.BOT_CHAT_ADMIN
    );

    async execute(msg: Message): Promise<void> {
        await bot.leaveChat({chat_id: msg.chat.id});
    }
}