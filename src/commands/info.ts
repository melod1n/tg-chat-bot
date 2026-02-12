import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {callbackCommands, commands} from "../index";
import {Environment} from "../common/environment";
import {boolToEmoji, getCurrentModel, getCurrentModelCapabilities, logError, replyToMessage} from "../util/utils";
import {AiModelCapabilities} from "../model/ai-model-capabilities";
import {AiProvider} from "../model/ai-provider";
import {Command} from "../base/command";

export class Info extends Command {
    command = ["info", "v"];

    title = "/info";
    description = "Info about bot";

    async execute(msg: Message): Promise<void> {
        const aiProvider = Environment.DEFAULT_AI_PROVIDER;
        const aiModel = getCurrentModel();
        let aiModelCapabilities: AiModelCapabilities = {};

        try {
            aiModelCapabilities = await getCurrentModelCapabilities();
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
            `vision${aiModelCapabilities.vision?.external ? "(ext)" : ""}: ${boolToEmoji(aiModelCapabilities.vision?.supported)}\n` +
            `ocr${aiModelCapabilities.ocr?.external ? "(ext)" : ""}: ${boolToEmoji(aiModelCapabilities.ocr?.supported)}\n` +
            `thinking${aiModelCapabilities.thinking?.external ? "(ext)" : ""}: ${boolToEmoji(aiModelCapabilities.thinking?.supported)}\n` +
            `tools${aiModelCapabilities.tools?.external ? "(ext)" : ""}: ${boolToEmoji(aiModelCapabilities.tools?.supported)}` +
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