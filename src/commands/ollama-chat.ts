import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {bot, ollama} from "../index";
import {
    collectReplyChainText,
    editMessageText,
    escapeMarkdownV2Text,
    extractText,
    getPhotoMaxSize,
    logError,
    replyToMessage,
    startIntervalEditor
} from "../util/utils";
import {Environment} from "../common/environment";
import {MessageStore} from "../common/message-store";
import axios from "axios";
import * as fs from "node:fs";
import path from "node:path";

export class OllamaChat extends ChatCommand {
    regexp = /^\/ollama\s([^]+)/;
    title = "/ollama";
    description = "talk to AI (Ollama)";

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        console.log("match", match);
        return this.executeOllama(msg, match?.[1]);
    }

    async executeOllama(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        let imageFilePath: string | null = null;

        const maxSize = await getPhotoMaxSize(msg.photo);
        if (maxSize) {
            const imagePath = path.join(Environment.DATA_PATH, "temp");
            if (!fs.existsSync(imagePath)) {
                fs.mkdirSync(imagePath);
            }

            imageFilePath = path.join(imagePath, maxSize.unique_file_id + ".jpg");
            if (!fs.existsSync(imageFilePath)) {
                const res = await axios.get<ArrayBuffer>(maxSize.url, {responseType: "arraybuffer"});
                const src = Buffer.from(res.data);

                try {
                    fs.writeFileSync(imageFilePath, src);
                } catch (e) {
                    console.error(e);
                    imageFilePath = null;
                }
            }
        }

        const messageParts = await collectReplyChainText(msg);
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map((part, i) => {
            return {
                role: part.bot ? "ASSISTANT" : "USER",
                content: extractText(part.content, Environment.BOT_PREFIX),
                images: imageFilePath && i === 0 ? [imageFilePath] : null
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "SYSTEM", content: Environment.SYSTEM_PROMPT, images: null});

        let waitMessage: Message;

        const startTime = Date.now();

        try {
            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                }
            });

            const stream = await ollama.chat({
                model: Environment.OLLAMA_MODEL,
                stream: true,
                think: false,
                keep_alive: 300,
                messages: chatMessages
            });

            let currentText = "";
            let shouldBreak = false;

            const editor = startIntervalEditor({
                intervalMs: 4500,
                getText: () => currentText,
                editFn: async (text) => {
                    await editMessageText(chatId, waitMessage.message_id, escapeMarkdownV2Text(text), "Markdown");
                },
                onStop: async () => {
                }
            });

            try {
                for await (const chunk of stream) {
                    const content = chunk.message.content;
                    currentText += content;

                    const length = currentText.length;
                    if (length > 4096) {
                        currentText = currentText.slice(0, 4093) + "...";
                        shouldBreak = true;
                    }

                    if (shouldBreak || chunk.done) {
                        console.log("messageText", currentText);
                        console.log("length", length);

                        if (shouldBreak) {
                            console.log("break", true);
                        } else {
                            console.log("ended", true);
                        }

                        stream.abort();

                        const diff = Math.abs(Date.now() - startTime) / 1000;

                        await editor.tick();
                        await editor.stop();

                        waitMessage.reply_to_message = msg;
                        waitMessage.text = currentText;
                        await MessageStore.put(waitMessage);

                        await replyToMessage(waitMessage, `⏱️ ${diff}s`);
                        break;
                    }
                }
            } finally {
                await editor.tick();
                await editor.stop();
            }
        } catch (error) {
            console.error(error);
            await replyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
        return Promise.resolve();
    }
}