import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, oldReplyToMessage, randomValue} from "../util/utils";

export class Choice extends Command {
    command = "choice";
    argsMode = "required" as const;

    title = "/choice a, b, ..., c";
    description = "Выбор случайного значения";

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("match", match);

        const payload = match[3];

        const re =
            /\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,]+?))\s*(?:,|$)/g;

        const out: string[] = [];
        for (const mm of payload.matchAll(re)) {
            const raw = (mm[1] ?? mm[2] ?? mm[3] ?? "").trim();

            const val = raw
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t")
                .replace(/\\"/g, "\"")
                .replace(/\\'/g, "'")
                .replace(/\\\\/g, "\\");

            if (val.length) out.push(val);
        }

        const random = randomValue(out);

        await oldReplyToMessage(msg, `Выбрал *${random}*`, "Markdown").catch(logError);
    }
}