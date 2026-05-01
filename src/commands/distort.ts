import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {downloadTelegramFile, extractImageFileId, logError, oldReplyToMessage, waveDistortSharp} from "../util/utils";
import {bot} from "../index";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {Environment} from "../common/environment";

export class Distort extends Command {
    command = "distort";
    argsMode = "optional" as const;

    title = Environment.commandTitles.distort;
    description = Environment.commandDescriptions.distort;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const chatId = msg.chat.id;

        const reply = msg.reply_to_message;
        if (!reply) {
            await oldReplyToMessage(
                msg,
                Environment.distortReplyInstructionText
            );
            return;
        }

        const fileId = extractImageFileId(reply);
        if (!fileId) {
            await oldReplyToMessage(
                msg,
                Environment.distortMissingImageText
            );
            return;
        }

        const args = (match?.[3] ?? "").trim();
        const [a, b] = args ? args.split(/\s+/) : [];
        const amp = a ? Number(a) : 14;
        const wavelength = b ? Number(b) : 72;

        try {
            await enqueueTelegramApiCall(
                () => bot.sendChatAction({chat_id: chatId, action: "upload_photo"}),
                {method: "sendChatAction", chatId, chatType: msg.chat.type}
            );

            const file = await bot.getFile({file_id: fileId});
            if (!file.file_path) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error("No file_path in Telegram getFile response");
            }

            const inputBuf = await downloadTelegramFile(file.file_path);

            const outBuf = await waveDistortSharp(<Buffer>inputBuf, amp, wavelength);

            await enqueueTelegramApiCall(
                () => bot.sendPhoto({
                    chat_id: chatId,
                    photo: outBuf,
                    caption: Environment.getDistortionReadyCaption(amp, wavelength),
                }),
                {method: "sendPhoto", chatId, chatType: msg.chat.type}
            );
        } catch (error) {
            await oldReplyToMessage(
                msg, Environment.getDistortFailedText(error instanceof Error ? error : String(error))
            ).catch(logError);
        }
    }
}
