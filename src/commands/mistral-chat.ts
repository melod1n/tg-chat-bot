import {Message} from "typescript-telegram-bot-api";
import {ChatCommand} from "../base/chat-command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {AiProvider} from "../model/ai-provider";
import {runUnifiedAi} from "../ai/unified-ai-runner";
import {Environment} from "../common/environment";

export class MistralChat extends ChatCommand {
    command = ["mistral", "mistral-chat", "mistral-voice"];
    argsMode = "required" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    title = Environment.commandTitles.mistralChat;
    description = Environment.commandDescriptions.mistralChat;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const command = match?.[1]?.toLowerCase() ?? "";
        await runUnifiedAi({
            provider: AiProvider.MISTRAL,
            msg: msg,
            text: match?.[3] ?? "",
            stream: true,
            synthesizeSpeechResponse: command.endsWith("-voice"),
        });
    }
}
