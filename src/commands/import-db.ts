import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot} from "../index";
import {DatabaseManager, type DatabaseBackupPayload} from "../db/database-manager";
import {downloadTelegramFile, logError, replyToMessage, sendErrorPlaceholder} from "../util/utils";
import {Environment} from "../common/environment";
import {MessageStore} from "../common/message-store";
import {UserStore} from "../common/user-store";

export class ImportDb extends Command {
    command = ["importdb"];

    argsMode = "optional" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        try {
            const payloadText = await this.resolvePayloadText(msg, match);
            if (!payloadText) {
                await replyToMessage({message: msg, text: Environment.databaseImportNeedJsonText});
                return;
            }

            const payload = JSON.parse(payloadText) as DatabaseBackupPayload;
            const result = await DatabaseManager.importBackupFromJsonPayload(payload);

            MessageStore.clear();
            UserStore.clear();

            await replyToMessage({
                message: msg,
                text: `${Environment.databaseImportDoneText} Users: ${result.users}, messages: ${result.messages}.`,
            });
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
            await sendErrorPlaceholder(msg);
        }
    }

    private async resolvePayloadText(msg: Message, match?: RegExpExecArray | null): Promise<string | null> {
        const argText = match?.[3]?.trim();
        if (argText) return argText;

        const document = msg.document ?? msg.reply_to_message?.document;
        if (!document) return null;

        const file = await bot.getFile({file_id: document.file_id});
        const buffer = await downloadTelegramFile(file.file_path);
        return buffer ? buffer.toString("utf8").trim() : null;
    }
}
