import {Message} from "typescript-telegram-bot-api";
import {ChatCommand} from "../base/chat-command";
import {Environment} from "../common/environment";
import {logError, replyToMessage} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {ollama} from "../index";

export class OllamaSetModel extends ChatCommand {
    argsMode = "required" as const;

    title = "/ollamaSetModel";
    description = "Set Ollama model";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        const newModel = match?.[3];

        try {
            await ollama.show({model: newModel});

            Environment.setOllamaModel(newModel || Environment.OLLAMA_MODEL);

            const text = newModel ? `Выбрана модель "${newModel}"`
                : `Модель не задана. Будет использоваться стандартная модель "${Environment.OLLAMA_MODEL}".`;

            await replyToMessage({message: msg, text: text}).catch(logError);
        } catch (e) {
            logError(e);
            await replyToMessage({message: msg, text: e.toString()}).catch(logError);
        }
    }
}