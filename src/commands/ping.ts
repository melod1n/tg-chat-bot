import {logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {ChatCommand} from "../base/chat-command";

export class Ping implements ChatCommand {
    regexp = /^\/ping/i;
    title = "/ping";
    description = "Ping between received and sent message";

    async execute(msg: Message) {
        const then = new Date().getMilliseconds();
        await oldSendMessage(msg, "pong").catch(logError);
        const now = new Date().getMilliseconds();
        const diff = Math.abs(now - then);
        await oldSendMessage(msg, `ping: ${diff}ms`).catch(logError);
    }
}