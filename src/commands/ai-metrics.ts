import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command.js";
import {Requirements} from "../base/requirements.js";
import {Requirement} from "../base/requirement.js";
import {Environment} from "../common/environment.js";
import {buildAiMetricsReport, replyWithTrimmedText} from "./ai-observability.js";
import {logError, sendErrorPlaceholder} from "../util/utils.js";

export class AIMetrics extends Command {
    command = ["aimetrics", "metrics"];
    argsMode = "none" as const;

    requirements = Requirements.Build(Requirement.BOT_ADMIN);

    title = Environment.commandTitles.aiMetrics;
    description = Environment.commandDescriptions.aiMetrics;

    async execute(msg: Message): Promise<void> {
        try {
            const text = await buildAiMetricsReport();
            await replyWithTrimmedText(msg, text);
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
            await sendErrorPlaceholder(msg).catch(logError);
        }
    }
}
