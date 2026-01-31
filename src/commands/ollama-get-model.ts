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
            const model = Environment.OLLAMA_MODEL;
            const imageModel = Environment.OLLAMA_IMAGE_MODEL;
            const thinkModel = Environment.OLLAMA_THINK_MODEL;

            const promises: (Promise<ShowResponse | null> | null)[] = [this.loadModelInfo()];

            if (imageModel && imageModel !== model) {
                promises.push(this.loadImageModelInfo());
            } else {
                promises.push(null);
            }

            if (thinkModel && thinkModel !== model) {
                promises.push(this.loadThinkModelInfo());
            } else {
                promises.push(null);
            }

            const infos = await Promise.all(promises);

            let modelInfo = infos[0];
            const modelText = "```Text\n" + this.getModelText(model, modelInfo) + "```";

            modelInfo = infos[1];
            const imageModelText = modelInfo ?
                "```Image\n" + this.getModelText(imageModel, modelInfo) + "```" : null;

            modelInfo = infos[2];
            const thinkModelText = modelInfo ?
                "```Think\n" + this.getModelText(thinkModel, modelInfo) + "```" : null;

            const modelInfos = [modelText];
            if (imageModelText) {
                modelInfos.push(imageModelText);
            }
            if (thinkModelText) {
                modelInfos.push(thinkModelText);
            }

            await replyToMessage({
                message: msg,
                text: modelInfos.join("\n\n"),
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

    async loadThinkModelInfo(): Promise<ShowResponse | null> {
        return ollama.show({model: Environment.OLLAMA_THINK_MODEL});
    }
}