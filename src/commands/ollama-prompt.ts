import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {abortOllamaRequest, bot, getOllamaRequest, ollama, ollamaRequests} from "../index";
import {escapeMarkdownV2Text, logError, oldReplyToMessage, startIntervalEditor} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";
import {Cancel} from "../callback_commands/cancel";
import {OllamaCancel} from "../callback_commands/ollama-cancel";
import {MessageStore} from "../common/message-store";

export class OllamaPrompt extends Command {
    command = "ollamaPrompt";
    argsMode = "required" as const;

    title = "/ollamaPrompt";
    description = "Custom prompt for AI (Ollama)";

    requirements = Requirements.Build(Requirement.BOT_ADMIN);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("match", match);
        return this.executeOllama(msg, match?.[3]);
    }

    async executeOllama(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;
        const chatId = msg.chat.id;

        let waitMessage: Message;

        const startTime = Date.now();

        try {
            const uuid = crypto.randomUUID();
            const cancelMarkup = {inline_keyboard: [[Cancel.withData(new OllamaCancel().data + " " + uuid).asButton()]]};

            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                }
            });

            const stream = await ollama.generate({
                model: Environment.OLLAMA_MODEL,
                stream: true,
                think: false,
                prompt: text
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

                    const content = chunk.response;

                    if (content === "<think>" || chunk.thinking) {
                        if (!isThinking) {
                            await bot.editMessageText({
                                chat_id: chatId,
                                message_id: waitMessage.message_id,
                                text: "🤔 Размышляю...",
                                parse_mode: "Markdown",
                            }).catch(logError);
                        }

                        isThinking = true;
                    }

                    if (!isThinking) {
                        currentText += content;
                    }

                    if (isThinking && !chunk.thinking) {
                        currentText += content;
                    }

                    if (content === "</think>" || !chunk.thinking) {
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