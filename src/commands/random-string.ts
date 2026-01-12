import {ChatCommand} from "../base/chat-command";
import {getRandomInt, logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";

export class RandomString implements ChatCommand {
    regexp = /^\/randomString/i;
    title = "/randomString [length]";
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

        await oldSendMessage(msg, result).catch(logError);
    }
}