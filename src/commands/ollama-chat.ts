import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {abortOllamaRequest, bot, getOllamaRequest, ollama, ollamaRequests} from "../index";
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
import {Cancel} from "../callback_commands/cancel";
import {OllamaCancel} from "../callback_commands/ollama-cancel";

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
                role: part.bot ? "assistant" : "user",
                content: (Environment.USE_NAMES_IN_PROMPT && !part.bot ? `MESSAGE FROM USER "${part.name}":\n` : "") + extractText(part.content, Environment.BOT_PREFIX),
                images: imageFilePath && i === 0 ? [imageFilePath] : null
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "system", content: Environment.SYSTEM_PROMPT, images: null});

        let waitMessage: Message;

        const startTime = Date.now();

        try {
            let isOver: boolean = false;
            const uuid = crypto.randomUUID();
            const cancelMarkup = {inline_keyboard: [[Cancel.withData(new OllamaCancel().data + " " + uuid).asButton()]]};

            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: maxSize !== null ? `🔍 Внимательно изучаю изображение...\n🤓 ${maxSize.width}x${maxSize.height}px` : Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                },
                reply_markup: cancelMarkup
            });

            const stream = await ollama.chat({
                model: Environment.OLLAMA_MODEL,
                stream: true,
                think: false,
                keep_alive: 300,
                messages: chatMessages,
                options: {
                    temperature: 0.1,
                    top_p: 0.8,
                    repeat_penalty: 1.15
                }
            });

            ollamaRequests.push({uuid: uuid, stream: stream, done: false, fromId: msg.from.id, chatId: msg.chat.id});

            let currentText = "";
            let shouldBreak = false;

            const editor = startIntervalEditor({
                intervalMs: 4500,
                getText: () => currentText,
                editFn: async (text) => {
                    await editMessageText(
                        chatId,
                        waitMessage.message_id,
                        escapeMarkdownV2Text(text),
                        "Markdown",
                        isOver ? {inline_keyboard: []} : cancelMarkup
                    ).catch(logError);
                },
                onStop: async () => {
                }
            });

            try {
                for await (const chunk of stream) {
                    if (!getOllamaRequest(uuid).done) {
                        currentText += chunk.message.content;

                        if (currentText.length > 4096) {
                            currentText = currentText.slice(0, 4093) + "...";
                            shouldBreak = true;
                        }
                    } else {
                        shouldBreak = true;
                    }

                    if (shouldBreak || chunk.done) {
                        isOver = true;

                        console.log("messageText", currentText);
                        console.log("length", currentText.length);

                        if (shouldBreak) {
                            console.log("break", true);
                        } else {
                            console.log("ended", true);
                        }

                        console.log(`aborted request ${uuid}:`, abortOllamaRequest(uuid));

                        const diff = Math.abs(Date.now() - startTime) / 1000;

                        await editor.tick();
                        await editor.stop();

                        waitMessage.reply_to_message = msg;
                        waitMessage.text = currentText;
                        await MessageStore.put(waitMessage);

                        await replyToMessage(waitMessage, `⏱️ ${diff}s` + (maxSize !== null ? `\n🤓 ${maxSize.width}x${maxSize.height}px` : ""));
                        break;
                    }
                }
            } finally {
                console.log(`aborted request ${uuid}:`, abortOllamaRequest(uuid));
                await editor.tick();
                await editor.stop();
            }
        } catch (error) {
            if (error.message.toLowerCase().includes("aborted")) return;

            await bot.editMessageReplyMarkup({
                chat_id: chatId,
                message_id: waitMessage.message_id,
                reply_markup: {inline_keyboard: []}
            }).catch(logError);

            console.error(error);
            await replyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
    }
}