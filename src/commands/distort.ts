import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {downloadTelegramFile, extractImageFileId, logError, replyToMessage, waveDistortSharp} from "../util/utils";
import {bot} from "../index";

export class Distort extends ChatCommand {
    regexp = /^\/distort(?:@[\w_]+)?(?:\s+(\d+))?(?:\s+(\d+))?\s*$/i;
    title = "/distort [amp] [wavelength]";
    description = "Distortion of picture";

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const chatId = msg.chat.id;

        const reply = msg.reply_to_message;
        if (!reply) {
            await replyToMessage(
                msg,
                "Ответь командой /distort на сообщение с картинкой (фото, документ или стикер).\n" + "Пример: /distort 16 80"
            );
            return;
        }

        const fileId = extractImageFileId(reply);
        if (!fileId) {
            await replyToMessage(
                msg,
                "В реплае не вижу картинку. Пришли фото или файл-изображение."
            );
            return;
        }

        const amp = match?.[1] ? parseInt(match[1], 10) : 14;
        const wavelength = match?.[2] ? parseInt(match[2], 10) : 72;

        try {
            await bot.sendChatAction({chat_id: chatId, action: "upload_photo"});

            const file = await bot.getFile({file_id: fileId});
            if (!file.file_path) throw new Error("No file_path in Telegram getFile response");

            const inputBuf = await downloadTelegramFile(file.file_path);

            const outBuf = await waveDistortSharp(inputBuf, amp, wavelength);

            await bot.sendPhoto({
                chat_id: chatId,
                photo: outBuf,
                caption: `Искажение готово ✅ (amp=${amp}, wavelength=${wavelength})`,
            });
        } catch (e) {
            await replyToMessage(
                msg, `Не получилось исказить изображение: ${e?.message ?? String(e)}`
            ).catch(logError);
        }
    }
}