import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, oldReplyToMessage, randomValue} from "../util/utils";
import {prepareTelegramMarkdownV2} from "../util/markdown-v2-renderer";
import {Environment} from "../common/environment";
import {appLogger} from "../logging/logger";

const logger = appLogger.child("command:choice");

export class Choice extends Command {
    command = "choice";
    argsMode = "required" as const;

    title = Environment.commandTitles.choice;
    description = Environment.commandDescriptions.choice;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        logger.debug("execute", {chatId: msg.chat?.id, messageId: msg.message_id, match});

        const payload = match?.[3] || "";

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
        if (!random) {
            await oldReplyToMessage(msg, Environment.noChoicesText).catch(logError);
            return;
        }

        await oldReplyToMessage(
            msg,
            Environment.getChoiceText(prepareTelegramMarkdownV2(random, {mode: "final"})),
            "MarkdownV2"
        ).catch(logError);
    }
}
