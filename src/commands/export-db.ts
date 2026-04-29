import {Command} from "../base/command";
import {FileOptions, Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";
import fs from "node:fs";
import {logError, replyToMessage, sendErrorPlaceholder} from "../util/utils";
import {bot} from "../index";

export class ExportDb extends Command {

    command = ["exportdb"];

    argsMode = "none" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        const fullPath = Environment.DB_PATH.substring(5);
        if (!fs.existsSync(fullPath)) {
            await sendErrorPlaceholder(msg);
            return;
        }

        try {
            const buffer = fs.readFileSync(fullPath);

            await bot.sendDocument({
                chat_id: Environment.CREATOR_ID,
                document: new FileOptions(buffer, {filename: "database.db", contentType: "application/sql"}),
                caption: "Бэкап базы данных",
            });
            await replyToMessage({message: msg, text: "Успешно отправлено в ЛС создателю!"});
        } catch (e) {
            logError(e);
            await sendErrorPlaceholder(msg);
        }
    }
}