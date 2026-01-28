import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";
import {bot, googleAi} from "../index";
import {MessageStore} from "../common/message-store";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {ApiError} from "@google/genai";
import {
    collectReplyChainText,
    escapeMarkdownV2Text,
    logError,
    oldReplyToMessage,
    startIntervalEditor
} from "../util/utils";
import fs from "node:fs";

export class GeminiChat extends ChatCommand {
    command = "gemini";
    argsMode = "required" as const;

    title = "/gemini";
    description = "Chat with AI (Gemini)";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("match", match);
        return this.executeGemini(msg, match?.[3]);
    }

    async executeGemini(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        const messageParts = await collectReplyChainText(msg);
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map(part => {
            return {
                role: part.bot ? "assistant" : "user",
                content: (Environment.USE_NAMES_IN_PROMPT && !part.bot ? `MESSAGE FROM USER "${part.name}":\n` : "") + part.content
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "system", content: Environment.SYSTEM_PROMPT});

        let chatContent = "";
        for (const part of chatMessages) {
            chatContent += `${part.role.toUpperCase()}:\n${part.content}\n\n`;
        }

        chatContent = chatContent.trim();

        const input = [];
        input.push(
            {
                type: "text",
                text: chatContent
            }
        );

        if (messageParts[0].images?.length) {
            const images = messageParts[0].images;

            images.forEach(image=>{
                const base64Image = Buffer.from(fs.readFileSync(image)).toString("base64");
                input.push({
                    type: "image",
                    data: base64Image,
                    mime_type: "image/png"
                });
            });
        }

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

            const stream = await googleAi.interactions.create({
                model: Environment.GEMINI_MODEL,
                input: input,
                stream: true
            });

            let currentText = "";
            let shouldBreak = false;

            const editor = startIntervalEditor({
                intervalMs: 4500,
                getText: () => currentText,
                editFn: async (text) => {
                    await bot.editMessageText(
                        {
                            chat_id: chatId,
                            message_id: waitMessage.message_id,
                            text: escapeMarkdownV2Text(text),
                            parse_mode: "Markdown"
                        }
                    ).catch(logError);

                    console.log("editMessageText", text);

                    waitMessage.reply_to_message = msg;
                    waitMessage.text = text;
                    await MessageStore.put(waitMessage);
                },
                onStop: async () => {
                }
            });
            await editor.tick();

            try {
                for await (const event of stream) {
                    switch (event.event_type) {
                        case "content.delta":
                            switch (event.delta?.type) {
                                case "text": {
                                    const text = event.delta.text;
                                    currentText += text;

                                    if (currentText.length > 4096) {
                                        currentText = currentText.slice(0, 4093) + "...";
                                        shouldBreak = true;
                                    }

                                    console.log("messageText", currentText);
                                    console.log("length", currentText.length);

                                    if (shouldBreak) {
                                        console.log("break", true);
                                        break;
                                    }
                                    break;
                                }
                            }
                    }
                }
            } finally {
                await editor.tick();
                await editor.stop();

                if (!shouldBreak) {
                    console.log("ended", true);
                }

                const diff = Math.abs(Date.now() - startTime) / 1000.0;
                console.log("time", diff);

                waitMessage.reply_to_message = msg;
                waitMessage.text = currentText;
                await MessageStore.put(waitMessage);
                await oldReplyToMessage(waitMessage, `⏱️ ${diff}s`);
            }
        } catch (error) {
            logError(error);

            if (error instanceof ApiError) {
                if (error.status === 429) {
                    await oldReplyToMessage(waitMessage, "На сегодня всё, лимиты закончились.").catch(logError);
                    return;
                }
            }

            await oldReplyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
    }
}