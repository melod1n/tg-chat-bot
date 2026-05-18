import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command.js";
import {Requirements} from "../base/requirements.js";
import {Requirement} from "../base/requirement.js";
import {Environment} from "../common/environment.js";
import {buildAiAuditReport, replyWithTrimmedText, resolveAuditTarget} from "./ai-observability.js";
import {logError, sendErrorPlaceholder} from "../util/utils.js";

export class AIAudit extends Command {
    command = ["aiaudit", "audit"];
    argsMode = "optional" as const;

    requirements = Requirements.Build(Requirement.BOT_ADMIN);

    title = Environment.commandTitles.aiAudit;
    description = Environment.commandDescriptions.aiAudit;

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        try {
            const target = resolveAuditTarget(msg, match?.[3] ?? null);
            if (!target) {
                await replyWithTrimmedText(msg, "Usage: reply to a message or pass messageId, or chatId messageId.");
                return;
            }

            const text = await buildAiAuditReport(target);
            await replyWithTrimmedText(msg, text);
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
            await sendErrorPlaceholder(msg).catch(logError);
        }
    }
}
