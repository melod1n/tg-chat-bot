import {logError, sendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command";
import {Environment} from "../common/environment";

export class Ping extends Command {
    title = Environment.commandTitles.ping;
    description = Environment.commandDescriptions.ping;

    async execute(msg: Message) {
        let d = new Date();
        const u = (n: number): string => n > 9 ? n.toString() : `0${n}`;
        const date = `${u(d.getDate())}.${u(d.getMonth() + 1)}.${d.getFullYear()}`;
        const time = `${u(d.getHours())}:${u(d.getMinutes())}:${u(d.getSeconds())}:${u(d.getMilliseconds())}`;

        const mDate = msg.date;
        const nowDate = new Date().getTime() / 1000;
        const diff = nowDate - mDate;
        const tgPing = (diff * 1000).toFixed(0);

        d = new Date(mDate * 1000);
        const msgDate = `${u(d.getDate())}.${u(d.getMonth() + 1)}.${d.getFullYear()}`;
        const msgTime = `${u(d.getHours())}:${u(d.getMinutes())}:${u(d.getSeconds())}:${u(d.getMilliseconds())}`;

        const then = Date.now();
        await sendMessage({message: msg, text: Environment.pongText}).catch(logError);
        const now = Date.now();
        const msgSendDiff = (now - then).toFixed(2);

        await sendMessage(
            {
                message: msg,
                text: Environment.getPingReportText(tgPing, msgSendDiff, msgDate, msgTime, date, time),
                parse_mode: "Markdown"
            }
        ).catch(logError);
    }
}
