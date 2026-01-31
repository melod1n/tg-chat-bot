import {ChatCommand} from "../base/chat-command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Message} from "typescript-telegram-bot-api";
import {
    collectReplyChainText,
    escapeMarkdownV2Text,
    logError,
    oldReplyToMessage,
    startIntervalEditor
} from "../util/utils";
import {Environment} from "../common/environment";
import {bot, mistralAi} from "../index";
import {MessageStore} from "../common/message-store";

export class MistralChat extends ChatCommand {
    command = "mistral";
    argsMode = "required" as const;

    title = "/mistral";
    description = "Chat with AI (Mistral)";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("match", match);
        return this.executeMistral(msg, match?.[3]);
    }

    async executeMistral(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        const storedMsg = await MessageStore.get(chatId, msg.message_id);
        const messageParts = await collectReplyChainText(storedMsg);
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map(part => {
            const content = [];
            content.push({
                type: "text",
                text: (Environment.USE_NAMES_IN_PROMPT && !part.bot ? `MESSAGE FROM USER "${part.name}":\n` : "") + part.content,
            });

            for (const image of part.images) {
                content.push({
                    type: "image_url",
                    imageUrl: "data:image/jpeg;base64," + image
                });
            }

            return {
                role: part.bot ? "assistant" : "user",
                content: content,
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({role: "system", content: [{type: "text", text: Environment.SYSTEM_PROMPT}]});

        let waitMessage: Message;

        const startTime = Date.now();

        try {
            const imagesCount = chatMessages.reduce((total, curr) => {
                return total + (curr.content.filter(c => c.type === "image_url")?.length ?? 0);
            }, 0);

            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: imagesCount ?
                    imagesCount > 1 ? Environment.analyzingPicturesText : Environment.analyzingPictureText
                    : Environment.waitText,

                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                }
            });

            const stream = await mistralAi.chat.stream({
                model: Environment.MISTRAL_MODEL,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                messages: chatMessages as any
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
                for await (const chunk of stream) {
                    console.log("chunk", chunk);

                    const text = chunk.data.choices[0].delta.content;
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
            await oldReplyToMessage(waitMessage, `Произошла ошибка!\n${error.toString()}`).catch(logError);
        }
    }
}