import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {editMessageText, logError, replyToMessage} from "../util/utils";
import {bot, botUser} from "../index";
import {DownloadOptions, downloadVideoFromYouTube, getYouTubeVideoId} from "../util/ytdl";
import {Environment} from "../common/environment";
import {TryAgain} from "../callback_commands/try-again";

export class YouTubeDownload extends Command {
    command = ["ytdl", "youtube"];
    argsMode = "required" as const;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const url = match?.[3];
        return this.downloadYouTubeVideo(msg, {url: url});
    }

    async downloadYouTubeVideo(msg: Message, options: DownloadOptions): Promise<void> {
        // TODO: 02.03.2026, Danil Nikolaev: add check for date
        let waitMessage: Message | null = (msg.from.id === botUser.id) ? msg : null;
        const videoId = "videoId" in options ? options.videoId : getYouTubeVideoId(options.url);

        try {
            if (!waitMessage) {
                waitMessage = await replyToMessage({message: msg, text: Environment.waitText});
            } else {
                await editMessageText({message: msg, text: Environment.waitText});
            }

            const {time, exists, buffer} = await downloadVideoFromYouTube({videoId: videoId});
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
                    caption: "✅ [Видео]" + (exists ? " загружено из кэша" : " успешно скачано") + " за " + (time + diff) + "мс",
                    parse_mode: "MarkdownV2"
                }) as Message;
            }
        } catch (e) {
            logError(e);

            if (waitMessage && "text" in waitMessage) {
                await bot.editMessageText({
                    chat_id: msg.chat.id,
                    message_id: waitMessage.message_id,
                    text: Environment.errorText,
                    reply_markup: {
                        inline_keyboard: [[
                            TryAgain.withData("/ytdl " + videoId).asButton()
                        ]]
                    }
                });
            }
        }
    }
}