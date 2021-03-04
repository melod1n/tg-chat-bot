import {Command} from "./base/command";
import {CREATOR_ID, getRandomInt, MessageContext} from "../base/base";
import {sendMessage} from "../base/net";

export class RandomString implements Command {
    regexp = /^\/randomstring\s(\d+)/i
    title: '/randomString [length]'
    description: 'строка из рандомных символов. Лимит 100 символов'

    async execute(context: MessageContext, params: string[]) {
        const l = parseInt(params[1])

        const length = l > 100 && context.senderId != CREATOR_ID ? 100 : l

        let result = '';

        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789';

        for (let i = 0; i < length; i++) {
            result += characters.charAt(getRandomInt(characters.length));
        }

        await sendMessage(context, result)
    }
}