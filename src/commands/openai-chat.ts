import {Message} from "typescript-telegram-bot-api";
import {MessageStore} from "../common/message-store";
import {
    collectReplyChainText,
    escapeMarkdownV2Text,
    logError,
    replyToMessage,
    startIntervalEditor
} from "../util/utils";
import {Environment} from "../common/environment";
import {bot, openAi} from "../index";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {ChatCommand} from "../base/chat-command";

export class OpenAIChat extends ChatCommand {
    command = ["openai", "chatgpt"];
    argsMode = "required" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    title = "/chatGPT";
    description = "Chat with AI (ChatGPT)";

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        console.log("OpenAI Chat: ", match);
        return this.executeOpenAI(msg, match?.[3]);
    }

    async executeOpenAI(msg: Message, text: string): Promise<void> {
        if (!text || text.trim().length === 0) return;

        const chatId = msg.chat.id;

        const storedMsg = await MessageStore.get(chatId, msg.message_id);
        const messageParts = await collectReplyChainText(storedMsg);
        console.log("MESSAGE PARTS", messageParts);

        const chatMessages = messageParts.map(part => {
            const content = [];
            content.push({
                type: "input_text",
                text: (Environment.USE_NAMES_IN_PROMPT && !part.bot ? `MESSAGE FROM USER "${part.name}":\n` : "") + part.content,
            });

            // TODO: 03/02/2026, Danil Nikolaev: upload file then add here
            // for (const image of part.images) {
            //     content.push({
            //         type: "image_url",
            //         imageUrl: "data:image/jpeg;base64," + image
            //     });
            // }

            return {
                role: part.bot ? "assistant" : "user",
                content: content,
                type: "message",
            };
        });
        chatMessages.reverse();
        chatMessages.unshift({
            role: "system",
            content: [{type: "input_text", text: Environment.SYSTEM_PROMPT}],
            type: "message"
        });

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

            const stream = await openAi.responses.create({
                model: Environment.OPENAI_MODEL,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                input: chatMessages as any,
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
                for await (const chunk of stream) {
                    console.log("chunk", chunk);

                    if (chunk.type === "response.output_text.delta") {
                        const text = chunk.delta;
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
                await replyToMessage({message: waitMessage, text: `⏱️ ${diff}s`});
            }
        } catch (error) {
            logError(error);
            await replyToMessage({
                message: waitMessage,
                text: `Произошла ошибка!\n${error.toString()}`
            }).catch(logError);
        }
    }
}