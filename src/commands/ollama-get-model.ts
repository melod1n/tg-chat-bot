import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {boolToEmoji, logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {ollama} from "../index";
import {AiModelCapabilities} from "../model/ai-model-capabilities";

export class OllamaGetModel extends Command {
    title = "/ollamaGetModel";
    description = "Ollama model info";

    async execute(msg: Message): Promise<void> {
        try {
            const model = Environment.OLLAMA_MODEL;
            const imageModel = Environment.OLLAMA_IMAGE_MODEL;
            const thinkModel = Environment.OLLAMA_THINK_MODEL;

            const promises: (Promise<AiModelCapabilities | null> | null)[] = [this.getModelCapabilities()];

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

    private getModelText(model: string, info: AiModelCapabilities): string {
        return `model: ${model}\n\n` +
            `vision: ${boolToEmoji(info.vision?.supported)}\n` +
            `thinking: ${boolToEmoji(info.thinking?.supported)}\n` +
            `tools: ${boolToEmoji(info.tools?.supported)}`;
    }

    async getModelCapabilities(model: string = Environment.OLLAMA_MODEL): Promise<AiModelCapabilities | null> {
        try {
            const info = await ollama.show({model: model});
            console.log(info);

            return {
                vision: {
                    supported: info.capabilities.includes("vision"),
                    external: model !== Environment.OLLAMA_MODEL,
                    model: model
                },
                ocr: {
                    supported: info.capabilities.includes("ocr"),
                    external: model !== Environment.OLLAMA_MODEL,
                    model: model
                },
                thinking: {
                    supported: info.capabilities.includes("thinking"),
                    external: model !== Environment.OLLAMA_MODEL,
                    model: model
                },
                tools: {
                    supported: info.capabilities.includes("tools"),
                    external: model !== Environment.OLLAMA_MODEL,
                    model: model
                },
            };
        } catch (e) {
            logError(e);
            return null;
        }
    }

    async loadImageModelInfo(): Promise<AiModelCapabilities | null> {
        return this.getModelCapabilities(Environment.OLLAMA_IMAGE_MODEL);
    }

    async loadThinkModelInfo(): Promise<AiModelCapabilities | null> {
        return this.getModelCapabilities(Environment.OLLAMA_THINK_MODEL);
    }
}