import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {boolToEmoji, logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {ollama} from "../index";
import {ShowResponse} from "ollama";

export class OllamaGetModel extends ChatCommand {
    title = "/ollamaGetModel";
    description = "Ollama model info";

    async execute(msg: Message): Promise<void> {
        try {
            let modelInfo = await this.loadModelInfo();
            const modelText = "```Text\n" + this.getModelText(Environment.OLLAMA_MODEL, modelInfo) + "```";
            modelInfo = await this.loadImageModelInfo();
            const imageModelText = "```Image\n" + this.getModelText(Environment.OLLAMA_IMAGE_MODEL, modelInfo) + "```";

            await replyToMessage({
                message: msg,
                text: modelText + "\n\n" + imageModelText,
                parse_mode: "Markdown"
            }).catch(logError);

        } catch (e) {
            logError(e);
            await replyToMessage({message: msg, text: e.toString()}).catch(logError);
        }
    }

    private getModelText(model: string, info: ShowResponse): string {
        const caps = info.capabilities;

        return `model: ${model}\n\n` +
            `vision: ${boolToEmoji(caps.includes("vision"))}\n` +
            `thinking: ${boolToEmoji(caps.includes("thinking"))}\n` +
            `tools: ${boolToEmoji(caps.includes("tools"))}`;
    }

    async loadModelInfo(): Promise<ShowResponse | null> {
        return ollama.show({model: Environment.OLLAMA_MODEL});
    }

    async loadImageModelInfo(): Promise<ShowResponse | null> {
        return ollama.show({model: Environment.OLLAMA_IMAGE_MODEL});
    }
}