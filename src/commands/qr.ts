import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {extractMessagePayload, logError, replyToMessage} from "../util/utils";
import {bot, botUser} from "../index";
import QRCode from "qrcode";

export class Qr extends ChatCommand {

    argsMode = "optional" as const;

    title = "/qr";
    description = "Generates QR-code from text you sent or replied to.";

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const chatId = msg.chat.id;

        let payload = extractMessagePayload(msg, match?.[3]);
        if (!payload) {
            await replyToMessage(
                {
                    message: msg,
                    text: "Не найден текст для генерации QR-кода."
                }
            );
            return;
        }

        if (payload.length > 1500) {
            payload = payload.slice(0, 1500);

            await replyToMessage(
                {
                    message: msg,
                    text: `Слишком длинный текст для QR (${payload.length} символов). Текст будет обрезан до 1500 символов.`
                }
            );
        }

        try {
            await bot.sendChatAction({chat_id: chatId, action: "upload_photo"});

            const pngBuffer = await QRCode.toBuffer(payload, {
                type: "png",
                errorCorrectionLevel: "L",
                margin: 2,
                scale: 8,
            });

            const maxCaptionLength = botUser.is_premium ? 4096 : 1024;

            await bot.sendPhoto({
                chat_id: chatId,
                photo: pngBuffer,
                caption: "QR-код готов ✅\nСодержимое:\n<blockquote expandable>" +
                    `${payload.length > maxCaptionLength ? payload.slice(0, maxCaptionLength - 40) + "..." : payload}` +
                    "</blockquote>",
                reply_parameters: {
                    message_id: msg.message_id,
                },
                parse_mode: "HTML"
            });
        } catch (e) {
            await replyToMessage({
                message: msg,
                text: `Не получилось сгенерировать QR: ${e?.message ?? String(e)}`
            }).catch(logError);
        }
    }
}