import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";
import {bot} from "../index";
import {downloadVideoFromYouTube} from "../util/ytdl";

export class YouTubeDownload extends ChatCommand {
    command = ["ytdl", "youtube"];
    argsMode = "required" as const;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const url = match?.[3];
        return this.downloadYouTubeVideo(msg, url);
    }

    async downloadYouTubeVideo(msg: Message, url: string): Promise<void> {
        let waitMessage: Message | null = null;

        try {
            waitMessage = await replyToMessage({message: msg, text: "⏳ Секунду..."});

            const {time, exists, buffer} = await downloadVideoFromYouTube(url);
            if (buffer) {
                const start = Date.now();
                waitMessage = await bot.editMessageMedia({
                    chat_id: msg.chat.id,
                    message_id: waitMessage.message_id,
                    media: {
                        type: "video",
                        media: buffer
                    }
                }) as Message;

                const diff = Date.now() - start;
                waitMessage = await bot.editMessageCaption({
                    chat_id: msg.chat.id,
                    message_id: waitMessage.message_id,
                    caption: `✅ [Видео](${url})` + (exists ? " загружено из кэша" : " успешно скачано") + " за " + (time + diff) + "мс",
                    parse_mode: "MarkdownV2"
                }) as Message;
            }
        } catch (e) {
            logError(e);

            if (waitMessage && "text" in waitMessage) {
                await bot.editMessageText({
                    chat_id: msg.chat.id,
                    message_id: waitMessage.message_id,
                    text: `⚠️ Произошла ошибка.\n${e}`,
                });
            }
        }
    }
}