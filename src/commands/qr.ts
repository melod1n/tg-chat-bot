import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {extractMessagePayload, logError, sendMessage} from "../util/utils";
import {bot} from "../index";
import QRCode from "qrcode";

export class Qr extends ChatCommand {
    regexp = /^\/qr/i;
    title = "/qr";
    description = "Generates QR-code from text you sent or replied to.";

    async execute(msg: Message): Promise<void> {
        const chatId = msg.chat.id;

        const split = msg.text?.split("/qr ");
        const matchText = split[1];

        const payload = extractMessagePayload(msg, matchText);
        if (!payload) {
            await sendMessage({
                chatId: chatId,
                text: "Отправь: /qr <текст или ссылка>\n" + "или ответь командой /qr на сообщение, из которого взять текст."
            });
            return;
        }

        if (payload.length > 1500) {
            await sendMessage({
                chatId: chatId,
                text: `Слишком длинный текст для QR (${payload.length} символов). Максимум 1500 символов.`
            });
            return;
        }

        try {
            await bot.sendChatAction({chat_id: chatId, action: "upload_photo"});

            const pngBuffer = await QRCode.toBuffer(payload, {
                type: "png",
                errorCorrectionLevel: "L",
                margin: 2,
                scale: 8,
            });

            await bot.sendPhoto({
                chat_id: chatId,
                photo: pngBuffer,
                caption: `QR готов ✅\nСодержимое: ${payload.length > 80 ? payload.slice(0, 80) + "…" : payload}`,
                reply_parameters: {
                    message_id: msg.message_id,
                }
            });
        } catch (e) {
            await sendMessage({chatId: chatId, text: `Не получилось сгенерировать QR: ${e?.message ?? String(e)}`}).catch(logError);
        }
    }
}