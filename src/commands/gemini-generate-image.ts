import {Command} from "../base/command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {googleAi} from "../index";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class GeminiGenerateImage extends Command {
    command = "geminiGenImage";
    argsMode = "required" as const;

    title = "/geminiGenImage";
    description = "Generate image with Gemini";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("match", match);

        const prompt = match?.[3];
        return this.executeGenImage(msg, prompt);
    }

    async executeGenImage(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        let waitMessage: Message;

        try {
            waitMessage = await replyToMessage({
                message: msg,
                text: Environment.genImageText,
            });

            const interaction = await googleAi.interactions.create({
                model: Environment.GEMINI_IMAGE_MODEL,
                response_modalities: ["image"],
                input: text,
            });

            interaction.outputs?.forEach((output, index) => {
                if (output.type === "image") {
                    // const image = output.data;
                    console.log(`Image output ${index + 1}:`, output);
                } else {
                    console.log(`Output ${index + 1}: ${output}`);
                }
            });
        } catch (e) {
            logError(e);

            await replyToMessage({
                message: waitMessage,
                text: `Произошла ошибка!\n${e.toString()}`,
                disableLinkPreview: true
            }).catch(logError);
        }
    }
}