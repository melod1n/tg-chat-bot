import {Command} from "../base/command";
import {getRandomInt, logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";

export class RandomInt extends Command {
    argsMode = "optional" as const;

    title = Environment.commandTitles.randomInt;
    description = Environment.commandDescriptions.randomInt;

    async execute(msg: Message) {
        if (!msg.text) return;

        const args = msg.text.trim().split(/\s+/).slice(1);
        const values = args
            .map(value => Number(value))
            .filter(value => Number.isSafeInteger(value));
        const min = values.length === 1 ? 1 : values[0];
        const max = values.length === 1 ? values[0] : values[1];

        const sufficient = Number.isSafeInteger(min) && Number.isSafeInteger(max);
        if (sufficient && min === max) {
            await oldSendMessage(msg, Environment.getRandomIntRangeText(min, max, min)).catch(logError);
            return;
        }

        const from = sufficient ? Math.min(min, max) : 0;
        const to = sufficient ? Math.max(min, max) : 1_000_000_000;
        const random = getRandomInt(to - from + 1) + from;

        const randomText = !sufficient ? random.toString() : Environment.getRandomIntRangeText(from, to, random);

        await oldSendMessage(msg, randomText).catch(logError);
    }
}
