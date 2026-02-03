import {Command} from "../base/command";
import {logError, oldSendMessage, randomValue} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";

export class WhatBetter extends Command {
    command = ["what", "что"];
    argsMode = "required" as const;

    title = "/what better [a] or [b]";
    description = "either a or b randomly (50% chance)";

    private argsRe = /^(better|лучше)\s+([\s\S]+?)\s+(or|или)\s+([\s\S]+)$/i;

    async execute(msg: Message, match?: RegExpExecArray) {
        const args = (match?.[3] ?? "").trim();
        const m = this.argsRe.exec(args);
        if (!m) return;
        const a = m[2].trim();
        const b = m[4].trim();

        const text = `${randomValue(Environment.ANSWERS.better)} ${randomValue([a, b])}`;

        await oldSendMessage(msg, text).catch(logError);
    }
}