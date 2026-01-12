import {ChatCommand} from "../base/chat-command";
import {logError, randomValue, oldSendMessage} from "../util/utils";
import {betterAnswers} from "../db/database";
import {Message} from "typescript-telegram-bot-api";

export class WhatBetter extends ChatCommand {
    regexp = /^\/(what|что)\s(better|лучше)\s([^]+)\s(or|или)\s([^]+)/i;
    title = "/what better [a] or [b]";
    description = "either a or b randomly (50% chance)";

    async execute(msg: Message, match?: RegExpExecArray) {
        const a = match[3];
        const b = match[5].trimStart();

        const text = `${randomValue(betterAnswers)} ${randomValue([a, b])}`;

        await oldSendMessage(msg, text).catch(logError);
    }
}