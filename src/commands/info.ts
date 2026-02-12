import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {callbackCommands, commands} from "../index";
import {AiProvider, Environment} from "../common/environment";
import {boolToEmoji, logError, replyToMessage} from "../util/utils";
import {OllamaGetModel} from "./ollama-get-model";

type AiCapabilityInfo = { supported?: boolean, external?: boolean, model?: string };

export class Info extends ChatCommand {
    command = ["info", "v"];

    title = "/info";
    description = "Info about bot";

    async execute(msg: Message): Promise<void> {
        const aiProvider = Environment.DEFAULT_AI_PROVIDER;
        let aiModel: string;
        let aiVisionSupported: AiCapabilityInfo = {};
        let aiThinkingSupported: AiCapabilityInfo = {};
        let aiToolsSupported: AiCapabilityInfo = {};

        try {
            switch (aiProvider) {
                case AiProvider.OLLAMA: {
                    const ollamaGetModel = commands.find(c => c instanceof OllamaGetModel);

                    aiModel = Environment.OLLAMA_MODEL;
                    aiVisionSupported = {
                        supported: (await ollamaGetModel.loadImageModelInfo()).capabilities.includes("vision"),
                        external: Environment.OLLAMA_IMAGE_MODEL !== Environment.OLLAMA_MODEL,
                        model: Environment.OLLAMA_IMAGE_MODEL
                    };

                    aiThinkingSupported = {
                        supported: (await ollamaGetModel.loadThinkModelInfo()).capabilities.includes("thinking"),
                        external: Environment.OLLAMA_THINK_MODEL !== Environment.OLLAMA_MODEL,
                        model: Environment.OLLAMA_THINK_MODEL
                    };

                    aiToolsSupported = {
                        supported: (await ollamaGetModel.loadModelInfo()).capabilities.includes("tools"),
                        external: false,
                        model: Environment.OLLAMA_MODEL
                    };
                    break;
                }
                case AiProvider.GEMINI:
                    aiModel = Environment.GEMINI_MODEL;

                    aiVisionSupported = {supported: true};
                    aiThinkingSupported = {};
                    aiToolsSupported = {};
                    break;
                case AiProvider.MISTRAL:
                    aiModel = Environment.MISTRAL_MODEL;

                    aiVisionSupported = {supported: true};
                    aiThinkingSupported = {};
                    aiToolsSupported = {};
                    break;
                case AiProvider.OPENAI:
                    aiModel = Environment.OPENAI_MODEL;

                    aiVisionSupported = {};
                    aiThinkingSupported = {};
                    aiToolsSupported = {};
                    break;
            }
        } catch (e) {
            logError(e);
            await replyToMessage({message: msg, text: `Произошла ошибка: ${e}`}).catch(logError);
            return;
        }

        const aiInfo = "```" +
            "AI\n" +
            `supported providers: ${Object.keys(AiProvider).filter(key => isNaN(Number(key))).length}\n\n` +

            `provider: ${aiProvider.toLowerCase()}\n` +
            `model: ${aiModel}\n\n` +
            `vision${aiVisionSupported.external ? "(ext)" : ""}: ${boolToEmoji(aiVisionSupported.supported)}\n` +
            `thinking${aiThinkingSupported.external ? "(ext)" : ""}: ${boolToEmoji(aiThinkingSupported.supported)}\n` +
            `tools: ${boolToEmoji(aiToolsSupported.supported)}` +
            "```";

        const cmds = commands.filter(c => !(c instanceof ChatCommand));
        const chatCmds = commands.filter(c => c instanceof ChatCommand);
        const callbackCmds = callbackCommands;

        const publicCmdsLength = cmds.filter(c => c.requirements?.isPublic()).length;
        const privateCmdsLength = cmds.length - publicCmdsLength;

        const chatCmdsLength = chatCmds.length;

        const callbackCmdsLength = callbackCmds.length;

        const text =
            aiInfo + "\n\n" +

            "```" +
            "Commands\n" +
            `Public: ${publicCmdsLength}\n` +
            `Private: ${privateCmdsLength}\n` +
            `Chat: ${chatCmdsLength}\n` +
            `Callback: ${callbackCmdsLength}\n` +
            "```"
        ;

        await replyToMessage({message: msg, text: text, parse_mode: "Markdown"}).catch(logError);
    }
}