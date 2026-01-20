import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {bot, ollama} from "../index";
import {editMessageText, ignore, oldReplyToMessage} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";

export class OllamaPrompt extends ChatCommand {
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

        try {
            waitMessage = await bot.sendMessage({
                chat_id: chatId,
                text: Environment.waitText,
                reply_parameters: {
                    chat_id: chatId,
                    message_id: msg.message_id
                },
                parse_mode: "Markdown"
            });

            const stream = await ollama.chat({
                model: Environment.OLLAMA_MODEL,
                stream: true,
                messages: [
                    {
                        role: "system",
                        content: text
                    }
                ]
            });

            let ended = false;
            let messageText = "";

            const interval = setInterval(async () => {
                const length = messageText.length;

                console.log("messageText", messageText);
                console.log("length", length);
                console.log("ended", ended);
                await editMessageText(chatId, waitMessage.message_id, messageText);
                if (ended) {
                    clearInterval(interval);
                }
            }, 4500);

            let shouldBreak = false;

            for await (const chunk of stream) {
                messageText += chunk.message.content;

                const length = messageText.length;

                if (length > 4096) {
                    messageText = messageText.slice(0, 4093) + "...";
                    shouldBreak = true;
                }

                if (shouldBreak) {
                    console.log("messageText", messageText);
                    console.log("length", length);
                    console.log("break", true);
                    ended = true;

                    stream.abort();
                    clearInterval(interval);

                    const diff = Math.abs(new Date().getSeconds() - waitMessage.date);
                    messageText += `\n\nДумал ${diff}s`;

                    await editMessageText(chatId, waitMessage.message_id, messageText);
                    await oldReplyToMessage(waitMessage, "Закончил лишь часть 😉");
                    break;
                }

                if (chunk.done) {
                    console.log("messageText", messageText);
                    console.log("length", messageText.length);
                    console.log("ended", true);
                    ended = true;
                    clearInterval(interval);

                    const diff = Math.abs(Date.now() / 1000 - waitMessage.date);
                    messageText += `\n\nДумал ${diff}s`;

                    await editMessageText(chatId, waitMessage.message_id, messageText);
                    await oldReplyToMessage(waitMessage, "Закончил 😉");
                }
            }
        } catch (error) {
            console.error(error);
            await editMessageText(chatId, waitMessage.message_id, `Произошла ошибка!\n${error.toString()}`)
                .catch(async (e) => {
                    await editMessageText(chatId, waitMessage.message_id, `Произошла ошибка!\n${e.toString()}`).catch(ignore);
                });
        }
    }
}