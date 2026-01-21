import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {abortOllamaRequest, bot, getOllamaRequest, ollama, ollamaRequests} from "../index";
import {
    collectReplyChainText,
    editMessageText,
    escapeMarkdownV2Text,
    extractText,
    logError,
    oldReplyToMessage,
    startIntervalEditor
} from "../util/utils";
import {Environment} from "../common/environment";
import {MessageStore} from "../common/message-store";
import {Cancel} from "../callback_commands/cancel";
import {OllamaCancel} from "../callback_commands/ollama-cancel";

export class OllamaChat extends ChatCommand {
    command = "ollama";
    argsMode = "required" as const;

    title = "/ollama";
    description = "Chat with AI (Ollama)";

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        console.log("match", match);
        return this.executeOllama(msg, match?.[3]);
    }

    async executeOllama(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        const messageParts = await collectReplyChainText(msg);
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map(part => {
            return {
                role: part.bot ? "assistant" : "user",
                content: (Environment.USE_NAMES_IN_PROMPT && !part.bot ? `MESSAGE FROM USER "${part.name}":\n` : "") + extractText(part.content, Environment.BOT_PREFIX),
                images: part.images
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "system", content: Environment.SYSTEM_PROMPT, images: []});

        let waitMessage: Message;

        const startTime = Date.now();

        try {
            let isOver: boolean = false;
            const uuid = crypto.randomUUID();
            const cancelMarkup = {inline_keyboard: [[Cancel.withData(new OllamaCancel().data + " " + uuid).asButton()]]};

            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                },
                reply_markup: cancelMarkup
            });

            const stream = await ollama.chat({
                model: Environment.OLLAMA_MODEL,
                stream: true,
                keep_alive: 300,
                think: false,
                messages: chatMessages,
            });

            ollamaRequests.push({uuid: uuid, stream: stream, done: false, fromId: msg.from.id, chatId: msg.chat.id});

            let currentText = "";
            let shouldBreak = false;

            const editor = startIntervalEditor({
                uuid: uuid,
                intervalMs: 4500,
                getText: () => currentText,
                editFn: async (text) => {
                    try {
                        await editMessageText(
                            chatId,
                            waitMessage.message_id,
                            escapeMarkdownV2Text(text),
                            "Markdown",
                            isOver ? {inline_keyboard: []} : cancelMarkup
                        );

                        waitMessage.reply_to_message = msg;
                        waitMessage.text = text;
                        await MessageStore.put(waitMessage);
                    } catch (e) {
                        logError(e);
                    }
                },
                onStop: async () => {
                }
            });
            await editor.tick();

            try {
                let isThinking = false;

                for await (const chunk of stream) {
                    const content = chunk.message.content;

                    if (content === "<think>" || chunk.message.thinking) {
                        if (!isThinking) {
                            await editMessageText(
                                chatId,
                                waitMessage.message_id,
                                "🤔 Размышляю...",
                                "Markdown",
                                isOver ? {inline_keyboard: []} : cancelMarkup
                            ).catch(logError);
                            console.log("Thinking:\n");
                        }

                        isThinking = true;
                    }

                    if (chunk.message.thinking) {
                        console.log(chunk.message.thinking);
                    } else {
                        console.log(chunk.message.content);
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
                        await oldReplyToMessage(waitMessage, `⏱️ ${diff}s`);
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
            await oldReplyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
    }
}