import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {escapeHtml, extractMessagePayload, logError, replyToMessage} from "../util/utils";
import {bot, botUser} from "../index";
import QRCode from "qrcode";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {Environment} from "../common/environment";

export class Qr extends Command {

    argsMode = "optional" as const;

    title = Environment.commandTitles.qr;
    description = Environment.commandDescriptions.qr;

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const chatId = msg.chat.id;

        let payload = extractMessagePayload(msg, match?.[3]);
        if (!payload) {
            await replyToMessage(
                {
                    message: msg,
                    text: Environment.qrCodeMissingTextText
                }
            );
            return;
        }

        const maxQrPayloadLength = 1500;
        if (payload.length > maxQrPayloadLength) {
            payload = payload.slice(0, maxQrPayloadLength);

            await replyToMessage(
                {
                    message: msg,
                    text: Environment.getQrCodeTextTooLongText(payload.length, maxQrPayloadLength)
                }
            );
        }

        try {
            await enqueueTelegramApiCall(
                () => bot.sendChatAction({chat_id: chatId, action: "upload_photo"}),
                {method: "sendChatAction", chatId, chatType: msg.chat.type}
            );

            const pngBuffer = await QRCode.toBuffer(payload, {
                type: "png",
                errorCorrectionLevel: "L",
                margin: 2,
                scale: 8,
            });

            const maxCaptionLength = botUser.is_premium ? 4096 : 1024;
            const visiblePayload = payload.length > maxCaptionLength - 80
                ? payload.slice(0, maxCaptionLength - 83) + "..."
                : payload;

            await enqueueTelegramApiCall(
                () => bot.sendPhoto({
                    chat_id: chatId,
                    photo: pngBuffer,
                    caption: Environment.getQrCodeReadyText(escapeHtml(visiblePayload)),
                    reply_parameters: {
                        message_id: msg.message_id,
                    },
                    parse_mode: "HTML"
                }),
                {method: "sendPhoto", chatId, chatType: msg.chat.type}
            );
        } catch (error) {
            await replyToMessage({
                message: msg,
                text: Environment.getQrCodeFailedText(error instanceof Error ? error : String(error))
            }).catch(logError);
        }
    }
}
