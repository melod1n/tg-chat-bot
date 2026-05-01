import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {getRangedRandomInt, logError, oldReplyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class Coin extends Command {
    title = Environment.commandTitles.coin;
    description = Environment.commandDescriptions.coin;

    async execute(msg: Message): Promise<void> {
        const random = getRangedRandomInt(0, 2);
        const headsOrTails = Environment.getCoinResultText(random === 1 ? Environment.coinHeadsText : Environment.coinTailsText) + " 🪙";
        await oldReplyToMessage(msg, headsOrTails, "Markdown").catch(logError);
    }
}
