import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {getRangedRandomInt, logError, replyToMessage} from "../util/utils";

export class Coin extends ChatCommand {
    regexp = /^\/coin$/i;
    title = "/coin";
    description = "Heads or tails";

    async execute(msg: Message): Promise<void> {
        const random = getRangedRandomInt(0, 2);
        const headsOrTails = random === 1 ? "Выпал *Орёл* 🪙" : "Выпала *Решка* 🪙";
        await replyToMessage(msg, headsOrTails, "Markdown").catch(logError);    }
}