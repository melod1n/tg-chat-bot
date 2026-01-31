import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {abortOllamaRequest, bot, chatCommands, getOllamaRequest, ollama, ollamaRequests} from "../index";
import {
    collectReplyChainText,
    escapeMarkdownV2Text,
    logError,
    oldReplyToMessage,
    replyToMessage,
    startIntervalEditor
} from "../util/utils";
import {Environment} from "../common/environment";
import {MessageStore} from "../common/message-store";
import {Cancel} from "../callback_commands/cancel";
import {OllamaCancel} from "../callback_commands/ollama-cancel";
import {OllamaGetModel} from "./ollama-get-model";

export class OllamaChat extends ChatCommand {
    command = ["ollama", "ollamathink"];
    argsMode = "required" as const;

    title = "/ollama";
    description = "Chat with AI (Ollama)";

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        console.log("match", match);
        return this.executeOllama(msg, match?.[3], match?.[1]?.toLowerCase()?.startsWith("ollamathink"));
    }

    async executeOllama(msg: Message, text: string, think: boolean = false): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        const storedMsg = await MessageStore.get(chatId, msg.message_id);
        const messageParts = await collectReplyChainText(storedMsg);
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map(part => {
            return {
                role: part.bot ? "assistant" : "user",
                content: (Environment.USE_NAMES_IN_PROMPT && !part.bot ? `MESSAGE FROM USER "${part.name}":\n` : "") + part.content,
                images: part.images
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "system", content: Environment.SYSTEM_PROMPT, images: []});

        let waitMessage: Message;

        const startTime = Date.now();

        try {
            const imagesCount = chatMessages.reduce((total, curr) => {
                return total + (curr.images?.length ?? 0);
            }, 0);

            if (!think && imagesCount) {
                try {
                    const modelInfo = await chatCommands.find(c => c instanceof OllamaGetModel).loadImageModelInfo();
                    if (modelInfo) {
                        const caps = modelInfo.capabilities || [];
                        if (!caps.includes("vision")) {
                            await replyToMessage({
                                message: msg,
                                text: "Моя текущая модель не умеет анализировать изображения 🥹"
                            });
                            return;
                        }
                    }
                } catch (e) {
                    logError(e);
                }
            }

            if (think) {
                try {
                    const modelInfo = await chatCommands.find(c => c instanceof OllamaGetModel).loadThinkModelInfo();
                    if (modelInfo) {
                        const caps = modelInfo.capabilities || [];
                        if (!caps.includes("thinking")) {
                            await replyToMessage({
                                message: msg,
                                text: "Моя текущая модель не умеет размышлять 🥹"
                            });
                            return;
                        }
                    }
                } catch (e) {
                    logError(e);
                }
            }

            const uuid = crypto.randomUUID();
            const cancelMarkup = {inline_keyboard: [[Cancel.withData(new OllamaCancel().data + " " + uuid).asButton()]]};

            waitMessage = await replyToMessage({
                message: msg,
                text: (!think && imagesCount) ?
                    imagesCount > 1 ? Environment.analyzingPicturesText : Environment.analyzingPictureText
                    : Environment.waitText
            });

            const stream = await ollama.chat({
                model: think ? Environment.OLLAMA_THINK_MODEL : imagesCount ? Environment.OLLAMA_IMAGE_MODEL : Environment.OLLAMA_MODEL,
                stream: true,
                think: think,
                messages: chatMessages,
            });

            const newRequest = {
                uuid: uuid,
                stream: stream,
                done: false,
                fromId: msg.from.id,
                chatId: msg.chat.id,
            };

            console.log("Pushing new request", newRequest);
            ollamaRequests.push(newRequest);

            await bot.editMessageReplyMarkup(
                {
                    chat_id: chatId,
                    message_id: waitMessage.message_id,
                    reply_markup: cancelMarkup
                }
            ).catch(logError);

            let currentText = "";
            let shouldBreak = false;

            const editor = startIntervalEditor({
                uuid: uuid,
                intervalMs: 4500,
                getText: () => currentText,
                editFn: async (text) => {
                    if (getOllamaRequest(uuid)?.done) return;

                    try {
                        await bot.editMessageText({
                            chat_id: chatId,
                            message_id: waitMessage.message_id,
                            text: escapeMarkdownV2Text(text),
                            parse_mode: "Markdown",
                            reply_markup: cancelMarkup
                        }).catch(logError);

                        console.log("editMessageText", text);

                        waitMessage.reply_to_message = msg;
                        waitMessage.text = text;
                        await MessageStore.put(waitMessage);
                    } catch (e) {
                        logError(e);
                    }
                }
            });
            await editor.tick();

            try {
                let isThinking = false;

                for await (const chunk of stream) {
                    const content = chunk.message.content;

                    if (content === "<think>" || chunk.message.thinking) {
                        if (!isThinking) {
                            await bot.editMessageText({
                                chat_id: chatId,
                                message_id: waitMessage.message_id,
                                text: "🤔 Размышляю...",
                                parse_mode: "Markdown",
                                reply_markup: cancelMarkup
                            }).catch(logError);
                        }

                        isThinking = true;
                    }

                    if (!isThinking) {
                        currentText += content;
                    }

                    if (isThinking && !chunk.message.thinking) {
                        currentText += content;
                    }

                    if (content === "</think>" || !chunk.message.thinking) {
                        isThinking = false;
                    }

                    if (currentText.length > 4096) {
                        currentText = currentText.slice(0, 4093) + "...";
                        shouldBreak = true;
                    }

                    if (getOllamaRequest(uuid).done) {
                        shouldBreak = true;
                    }

                    if (shouldBreak || chunk.done) {
                        console.log("messageText", currentText);
                        console.log("length", currentText.length);

                        if (shouldBreak) {
                            console.log("break", true);
                        } else {
                            console.log("ended", true);
                        }

                        const diff = Math.abs(Date.now() - startTime) / 1000;

                        await editor.tick();
                        await editor.stop();

                        console.log(`aborted request ${uuid}:`, abortOllamaRequest(uuid));

                        waitMessage.reply_to_message = msg;
                        waitMessage.text = currentText;
                        await MessageStore.put(waitMessage);
                        await oldReplyToMessage(waitMessage, `⏱️ ${diff}s`);
                        break;
                    }
                }
            } finally {
                await bot.editMessageReplyMarkup({
                    chat_id: chatId,
                    message_id: waitMessage.message_id,
                    reply_markup: {inline_keyboard: []}
                }).catch(logError);
            }
        } catch (error) {
            if (error.message.toLowerCase().includes("aborted")) return;

            await bot.editMessageReplyMarkup({
                chat_id: chatId,
                message_id: waitMessage.message_id,
                reply_markup: {inline_keyboard: []}
            }).catch(logError);

            logError(error);
            await oldReplyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
    }
}