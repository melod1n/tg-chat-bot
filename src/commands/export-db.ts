import {Command} from "../base/command";
import {FileOptions, Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";
import fs from "node:fs";
import {logError, replyToMessage, sendErrorPlaceholder} from "../util/utils";
import {bot} from "../index";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {DatabaseManager, type DatabaseBackupArtifact} from "../db/database-manager";

export class ExportDb extends Command {

    command = ["exportdb"];

    argsMode = "none" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        let backups: DatabaseBackupArtifact[] = [];
        try {
            backups = await DatabaseManager.exportBackupArtifacts();
            if (!backups.length) {
                throw new Error("Database backup artifacts were not created.");
            }

            for (const backup of backups) {
                await enqueueTelegramApiCall(
                    () => bot.sendDocument({
                        chat_id: Environment.CREATOR_ID,
                        document: new FileOptions(
                            fs.createReadStream(backup.filePath),
                            {filename: backup.fileName, contentType: backup.contentType},
                        ),
                        caption: Environment.databaseBackupCaption,
                    }),
                    {method: "sendDocument", chatId: Environment.CREATOR_ID, chatType: "private"}
                );
            }

            if (msg.chat.id !== Environment.CREATOR_ID) {
                await replyToMessage({message: msg, text: Environment.databaseBackupSentText});
            }
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
            await sendErrorPlaceholder(msg);
        } finally {
            for (const backup of backups) {
                await backup.cleanup();
            }
        }
    }
}
