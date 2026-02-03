import {Command} from "../base/command";
import {getRandomInt, logError, replyToMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";

export class RandomString extends Command {
    argsMode = "optional" as const;

    title = "/randomString";
    description = "literally random string (up to 4096 symbols)";

    async execute(msg: Message) {
        const split = msg.text.split(" ");
        const l = parseInt(split.length > 1 ? split[1] : "1");

        const length = (l <= 0 || l > 4096) ? 1 : l;

        let result = "";

        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789";

        for (let i = 0; i < length; i++) {
            result += characters.charAt(getRandomInt(characters.length));
        }

        await replyToMessage({
            message: msg,
            text: "<blockquote expandable>" + result + "</blockquote>",
            parse_mode: "HTML"
        }).catch(logError);
    }
}