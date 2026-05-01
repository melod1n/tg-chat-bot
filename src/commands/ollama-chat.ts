import {Message} from "typescript-telegram-bot-api";
import {ChatCommand} from "../base/chat-command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {AiProvider} from "../model/ai-provider";
import {runUnifiedAi} from "../ai/unified-ai-runner";
import {Environment} from "../common/environment";

export class OllamaChat extends ChatCommand {
    command = ["ollama", "ollama-chat", "ollama-voice", "think", "think-voice"];
    argsMode = "required" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    title = Environment.commandTitles.ollamaChat;
    description = Environment.commandDescriptions.ollamaChat;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const command = match?.[1]?.toLowerCase() ?? "";
        await runUnifiedAi({
            provider: AiProvider.OLLAMA,
            msg: msg,
            text: match?.[3] ?? "",
            stream: true,
            think: command.startsWith("think"),
            synthesizeSpeechResponse: command.endsWith("-voice"),
        });
    }
}
