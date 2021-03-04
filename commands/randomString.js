"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class RandomString {
    constructor() {
        this.regexp = /^\/randomstring\s(\d+)/i;
    }
    async execute(context, params) {
        const l = parseInt(params[1]);
        const length = l > 100 && context.senderId != base_1.CREATOR_ID ? 100 : l;
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(base_1.getRandomInt(characters.length));
        }
        await net_1.sendMessage(context, result);
    }
}
exports.RandomString = RandomString;
//# sourceMappingURL=randomString.js.map