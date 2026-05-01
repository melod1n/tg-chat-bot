import {Command} from "../base/command";
import {getRandomInt, logError, replyToMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";

export class RandomString extends Command {
    argsMode = "optional" as const;

    title = Environment.commandTitles.randomString;
    description = Environment.commandDescriptions.randomString;

    async execute(msg: Message) {
        if (!msg.text) return;

        const [, lengthArg] = msg.text.trim().split(/\s+/);
        const requestedLength = Number(lengthArg ?? 1);

        const length = Number.isSafeInteger(requestedLength)
            ? Math.min(4096, Math.max(1, requestedLength))
            : 1;

        const characters = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789");
        let result = "";

        for (let i = 0; i < length; i++) {
            result += characters[getRandomInt(characters.length)];
        }

        await replyToMessage({
            message: msg,
            text: Environment.getExpandableBlockquoteText(result),
            parse_mode: "HTML"
        }).catch(logError);
    }
}
