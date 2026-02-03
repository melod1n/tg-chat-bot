import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot} from "../index";

export class Leave extends Command {
    title = "/leave";
    description = "Bot will leave current chat";

    requirements = Requirements.Build(
        Requirement.BOT_ADMIN,
        Requirement.CHAT,
    );

    async execute(msg: Message): Promise<void> {
        await bot.leaveChat({chat_id: msg.chat.id});
    }
}