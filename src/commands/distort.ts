import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {downloadTelegramFile, extractImageFileId, logError, oldReplyToMessage, waveDistortSharp} from "../util/utils";
import {bot} from "../index";

export class Distort extends Command {
    command = "distort";
    argsMode = "optional" as const;

    title = "/distort [amp] [wavelength]";
    description = "Distortion of picture";

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const chatId = msg.chat.id;

        const reply = msg.reply_to_message;
        if (!reply) {
            await oldReplyToMessage(
                msg,
                "Ответь командой /distort на сообщение с картинкой (фото, документ или стикер).\n" + "Пример: /distort 16 80"
            );
            return;
        }

        const fileId = extractImageFileId(reply);
        if (!fileId) {
            await oldReplyToMessage(
                msg,
                "В реплае не вижу картинку. Пришли фото или файл-изображение."
            );
            return;
        }

        const args = (match?.[3] ?? "").trim();
        const [a, b] = args ? args.split(/\s+/) : [];
        const amp = a ? Number(a) : 14;
        const wavelength = b ? Number(b) : 72;

        try {
            await bot.sendChatAction({chat_id: chatId, action: "upload_photo"});

            const file = await bot.getFile({file_id: fileId});
            if (!file.file_path) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error("No file_path in Telegram getFile response");
            }

            const inputBuf = await downloadTelegramFile(file.file_path);

            const outBuf = await waveDistortSharp(inputBuf, amp, wavelength);

            await bot.sendPhoto({
                chat_id: chatId,
                photo: outBuf,
                caption: `Искажение готово ✅ (amp=${amp}, wavelength=${wavelength})`,
            });
        } catch (e) {
            await oldReplyToMessage(
                msg, `Не получилось исказить изображение: ${e?.message ?? String(e)}`
            ).catch(logError);
        }
    }
}