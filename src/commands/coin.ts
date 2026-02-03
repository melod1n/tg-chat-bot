import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {getRangedRandomInt, logError, oldReplyToMessage} from "../util/utils";

export class Coin extends Command {
    title = "/coin";
    description = "Heads or tails";

    async execute(msg: Message): Promise<void> {
        const random = getRangedRandomInt(0, 2);
        const headsOrTails = random === 1 ? "Выпал *Орёл* 🪙" : "Выпала *Решка* 🪙";
        await oldReplyToMessage(msg, headsOrTails, "Markdown").catch(logError);    }
}