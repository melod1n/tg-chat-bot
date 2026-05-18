import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command.js";
import {Requirements} from "../base/requirements.js";
import {Requirement} from "../base/requirement.js";
import {Environment} from "../common/environment.js";
import {DatabaseManager} from "../db/database-manager.js";
import {logError, sendErrorPlaceholder} from "../util/utils.js";
import {replyWithTrimmedText} from "./ai-observability.js";

function formatRequestLine(index: number, request: Awaited<ReturnType<typeof DatabaseManager.getAllAiRequests>>[number]): string {
    return [
        `${index + 1}.`,
        `requestId=${request.requestId}`,
        `chatId=${request.chatId}`,
        `messageId=${request.messageId}`,
        request.responseMessageId ? `responseMessageId=${request.responseMessageId}` : null,
        `provider=${request.provider}`,
        `model=${request.model}`,
        `status=${request.status}`,
        `startedAt=${request.startedAt}`,
        request.finishedAt ? `finishedAt=${request.finishedAt}` : null,
        request.error ? `error=${request.error}` : null,
    ].filter(Boolean).join(" ");
}

export class AIRequests extends Command {
    command = ["airequests"];
    argsMode = "none" as const;

    requirements = Requirements.Build(Requirement.BOT_ADMIN);

    title = Environment.commandTitles.aiRequests;
    description = Environment.commandDescriptions.aiRequests;

    async execute(msg: Message): Promise<void> {
        try {
            const requests = (await DatabaseManager.getAllAiRequests()).slice(-10).reverse();
            const lines = [
                "Recent AI requests",
                `count: ${requests.length}`,
                "",
                ...requests.map((request, index) => formatRequestLine(index, request)),
            ];

            await replyWithTrimmedText(msg, lines.join("\n"));
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
            await sendErrorPlaceholder(msg).catch(logError);
        }
    }
}
