import {Command} from "../base/command";
import {getRandomInt, getRangedRandomInt, logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";

export class RandomInt extends Command {
    argsMode = "optional" as const;

    title = "/randomInt";
    description = "Ranged random integer from parameters";

    async execute(msg: Message) {
        const split = msg.text.split(" ");
        const min = parseInt(split[1]);
        const max = parseInt(split[2]);

        const good = max > min;
        const sufficient = !!(min && max) && good;

        const random = !sufficient ? getRandomInt(Math.pow(2, 60)) : getRangedRandomInt(min, max);

        const randomText = !sufficient ? random.toString() : `[${min}; ${max}]: ${random}`;

        await oldSendMessage(msg, randomText).catch(logError);
    }
}