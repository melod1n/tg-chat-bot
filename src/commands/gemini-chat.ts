import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {
    collectReplyChainText,
    editMessageText,
    escapeMarkdownV2Text,
    logError,
    replyToMessage,
    startIntervalEditor
} from "../util/utils";
import {Environment} from "../common/environment";
import {bot, googleAi} from "../index";
import {MessageStore} from "../common/message-store";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {ApiError} from "@google/genai";

export class GeminiChat extends ChatCommand {
    regexp = /^\/gemini\s([^]+)/i;
    title = "/gemini";
    description = "Chat with AI (Gemini)";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("match", match);
        return this.executeGemini(msg, match?.[1]);
    }

    async executeGemini(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        const messageParts = await collectReplyChainText(msg, "/gemini");
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map(part => {
            return {
                role: part.bot ? "ASSISTANT" : "USER",
                content: part.content
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "SYSTEM", content: Environment.SYSTEM_PROMPT});

        let chatContent = "";
        for (const part of chatMessages) {
            chatContent += `${part.role.toUpperCase()}:\n${part.content}\n\n`;
        }

        chatContent = chatContent.trim();

        let waitMessage: Message;

        const startTime = new Date().getSeconds();

        try {
            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                }
            });

            const stream = await googleAi.models.generateContentStream({
                model: "gemini-2.5-flash",
                contents: chatContent,
            });

            let messageText = "";
            let shouldBreak = false;
            let diff = 0;

            const editor = startIntervalEditor({
                intervalMs: 4500,
                getText: () => messageText,
                editFn: async (text) => {
                    await editMessageText(chatId, waitMessage.message_id, escapeMarkdownV2Text(text), "Markdown");
                },
                onStop: async () => {
                }
            });

            try {
                for await (const chunk of stream) {
                    const text = chunk.text;

                    const length = (messageText + text).length;
                    if (length > 4096) {
                        messageText = messageText.slice(0, 4093) + "...";
                        shouldBreak = true;
                    } else {
                        messageText += text;
                    }

                    if (shouldBreak) {
                        console.log("messageText", messageText);
                        console.log("length", length);
                        console.log("break", true);

                        diff = Math.abs(new Date().getSeconds() - startTime);
                        await editor.tick();
                        await editor.stop();
                        break;
                    }

                    console.log("messageText", messageText);
                    console.log("length", messageText.length);

                    diff = Math.abs(new Date().getSeconds() - startTime);
                }
            } finally {
                await editor.tick();
                await editor.stop();

                console.log("time", diff);
                console.log("ended", true);

                waitMessage.reply_to_message = msg;
                waitMessage.text = messageText;
                MessageStore.put(waitMessage);

                await replyToMessage(waitMessage, `⏱️ ${diff}s`);
            }
        } catch (error) {
            console.error(error);

            if (error instanceof ApiError) {
                if (error.status === 429) {
                    await replyToMessage(waitMessage, "На сегодня всё, лимиты закончились.").catch(logError);
                    return;
                }
            }

            await replyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
    }
}