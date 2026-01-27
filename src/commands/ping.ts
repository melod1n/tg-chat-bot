import {logError, sendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {ChatCommand} from "../base/chat-command";

export class Ping extends ChatCommand {
    title = "/ping";
    description = "Ping between received and sent message";

    async execute(msg: Message) {
        const d = new Date();
        const u = (n: number): string => n > 9 ? n.toString() : `0${n}`;
        const date = `${u(d.getDay())}.${u(d.getMonth() + 1)}.${d.getFullYear()}`;
        const time = `${u(d.getHours())}:${u(d.getMinutes())}:${u(d.getSeconds())}:${u(d.getMilliseconds())}`;

        const msgDate = msg.date;
        const nowDate = new Date().getTime() / 1000;
        const diff = nowDate - msgDate;
        const tgPing = diff.toFixed(2);

        const then = Date.now();
        await sendMessage({message: msg, text: "pong"}).catch(logError);
        const now = Date.now();
        const msgSendDiff = (now - then).toFixed(2);

        await sendMessage(
            {
                message: msg,
                text:
                    "```ping\n" +
                    `TG: ${tgPing}ms\n` +
                    `API  ${msgSendDiff}ms\n\n` +
                    `🗓️ Local date : ${date}\n` +
                    `🕒 Local time: ${time}` +
                    "```",
                parse_mode: "Markdown"
            }
        ).catch(logError);
    }
}