import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {callbackCommands, commands} from "../index";
import {Environment} from "../common/environment";
import {logError, replyToMessage} from "../util/utils";
import {AiProvider} from "../model/ai-provider";
import {Command} from "../base/command";
import {getProviderTools} from "../ai/tool-mappers";
import {prepareTelegramMarkdownV2} from "../util/markdown-v2-renderer";
import {resolveEffectiveAiProviderForUser} from "../common/user-ai-settings";
import {getFormattedCapabilities} from "../ai/provider-model-runtime";

export class Info extends Command {
    command = ["info", "v"];

    title = Environment.commandTitles.info;
    description = Environment.commandDescriptions.info;

    async execute(msg: Message): Promise<void> {
        if (!msg.from) return;

        const getToolsInfo = async () => {
            const tools = getProviderTools(provider);
            return Environment.getInfoToolsBlockText(tools.map(t => t.function.name));
        };

        const getCommandsInfo = async () => {
            const cmds = commands.filter(c => !(c instanceof ChatCommand));
            const chatCmds = commands.filter(c => c instanceof ChatCommand);
            const callbackCmds = callbackCommands;
            const publicCmdsLength = cmds.filter(c => c.requirements?.isPublic()).length;
            const privateCmdsLength = cmds.length - publicCmdsLength;
            const chatCmdsLength = chatCmds.length;
            const callbackCmdsLength = callbackCmds.length;

            return Environment.getInfoCommandsBlockText({
                publicCommands: publicCmdsLength,
                privateCommands: privateCmdsLength,
                chatCommands: chatCmdsLength,
                callbackCommands: callbackCmdsLength,
            });
        };

        const provider = await resolveEffectiveAiProviderForUser(msg.from.id);
        // const aiProvidersLength = Object.keys(AiProvider).filter(key => isNaN(Number(key))).length;
        const aiProviders = Object.keys(AiProvider).map(p => p.toLowerCase());

        const finalText = [
            `\`\`\`${Environment.runtimeProviderLabelText}`,
            `${Environment.infoSupportedProvidersLabelText}: ${aiProviders.join(", ")}`,
            `${Environment.runtimeProviderCurrentLabelText}: ${provider.toLowerCase()}`,
            "```",
            "",

            `\`\`\`${Environment.runtimeCapabilitiesLabelText}`,
            (await getFormattedCapabilities(provider)).join("\n"),
            "```",
            "",

            await getToolsInfo(),
            await getCommandsInfo()
        ].join("\n");


        await replyToMessage({
            message: msg,
            text: prepareTelegramMarkdownV2(finalText, {mode: "final"}),
            parse_mode: "MarkdownV2"
        }).catch(logError);
    }
}
