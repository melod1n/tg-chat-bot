import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {escapeHtml, logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {createOllamaClient, resolveAiRuntimeTarget} from "../ai/ai-runtime-target";
import {AiProvider} from "../model/ai-provider";

export class OllamaSearch extends Command {
    command = ["s", "search"];
    argsMode = "required" as const;

    title = Environment.commandTitles.ollamaSearch;
    description = Environment.commandDescriptions.ollamaSearch;

    override requirements = Requirements.Build(Requirement.BOT_ADMIN);

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        const query = match?.[3] || "";
        if (!query || !query.length) return;

        try {
            const target = resolveAiRuntimeTarget(AiProvider.OLLAMA, "chat");
            const result = await createOllamaClient(target).webSearch({query, maxResults: 10});
            const body = (result.results ?? [])
                .map((item, index) => `${index + 1}. ${item.content}`)
                .join("\n\n");

            await replyToMessage({
                message: msg,
                text: Environment.searchResultsHeaderText + "<blockquote expandable>" + escapeHtml(body) + "</blockquote>",
                parse_mode: "HTML",
            });
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
            await replyToMessage({message: msg, text: Environment.errorText}).catch(logError);
        }
    }
}
