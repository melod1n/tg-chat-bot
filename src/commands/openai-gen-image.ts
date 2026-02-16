import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot, openAi, photoGenDir} from "../index";
import fs from "node:fs";
import path from "node:path";
import {editMessageText, logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {APIError} from "openai";

export class OpenAIGenImage extends ChatCommand {
    command = ["openAiGenImage", "chatGPTGenImage"];

    title = "/openAIGenImage";
    description = "Generate image from OpenAI";

    argsMode = "required" as const;
    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const prompt = match?.[3]?.trim();
        if (!prompt?.length) return;

        let waitMessage: Message | null = null;

        try {
            const totalParts = 3;
            const model = Environment.OPENAI_IMAGE_MODEL;
            const fileFullName = `${msg.chat.id}_${msg.message_id}.png`;
            const getFileLocation = (fn: string) => {
                return path.join(photoGenDir, fn);
            };

            waitMessage = await replyToMessage({message: msg, text: "🌈 Генерирую изображение..."});

            const stream = await openAi.images.generate({
                model: model,
                prompt: prompt,
                n: 1,
                size: "auto",
                stream: true,
                partial_images: totalParts,
                moderation: "low",
                output_format: "png",
            });

            const then = Date.now();

            for await (const event of stream) {
                switch (event.type) {
                    case "image_generation.partial_image": {
                        console.log(`  Partial image ${event.partial_image_index + 1}/3 received`);
                        console.log(`   Size: ${event.b64_json.length} characters (base64)`);

                        const fileName = `partial_${event.partial_image_index + 1}_${fileFullName}`;
                        const imageBuffer = Buffer.from(event.b64_json, "base64");
                        const fileLocation = getFileLocation(fileName);
                        fs.writeFileSync(fileLocation, imageBuffer);
                        console.log(`   💾 Saved to: ${path.resolve(fileLocation)}`);

                        await bot.editMessageMedia({
                            chat_id: msg.chat.id,
                            message_id: waitMessage.message_id,
                            media: {
                                type: "photo",
                                media: imageBuffer,
                                caption: `🌈 Генерирую изображение (${(event.partial_image_index + 1)}/${totalParts})...`
                            }
                        });
                        break;
                    }
                    case "image_generation.completed": {
                        console.log("\n✅ Final image completed!");
                        console.log(`   Size: ${event.b64_json.length} characters (base64)`);

                        const imageBuffer = Buffer.from(event.b64_json, "base64");
                        const fileLocation = getFileLocation(fileFullName);
                        fs.writeFileSync(fileLocation, imageBuffer);
                        console.log(`    Saved to: ${path.resolve(fileLocation)}`);

                        const diff = Date.now() - then;
                        await bot.editMessageMedia({
                            chat_id: msg.chat.id,
                            message_id: waitMessage.message_id,
                            media: {
                                type: "photo",
                                media: imageBuffer,
                                caption: `🌈 Изображение по запросу "${prompt}" сгенерировано моделью "${model}" размеров ${event.size} за ${diff}ms`
                            }
                        });
                        break;
                    }
                    default:
                        console.log(`❓ Unknown event: ${event}`);
                }
            }
        } catch (e) {
            logError(e);

            if (e instanceof APIError && e.error.code === "moderation_blocked") {
                const text = "❌ Мне запрещено такое генерировать 😠";

                if (waitMessage) {
                    await editMessageText(msg.chat.id, waitMessage.message_id, text).catch(logError);
                } else {
                    await replyToMessage({message: msg, text: text}).catch(logError);
                }
            } else {
                await replyToMessage({
                    message: waitMessage ? waitMessage : msg,
                    text: `Произошла ошибка: ${e}`
                }).catch(logError);
            }
        }
    }
}