import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery} from "typescript-telegram-bot-api";
import {abortOllamaRequest, bot, getOllamaRequest} from "../index";
import {logError} from "../util/utils";

export class OllamaCancel extends CallbackCommand {

    data = "/cancel_ollama";
    text = "Cancel Ollama generation";

    async execute(query: CallbackQuery): Promise<void> {
        const chatId = query.message.chat.id;
        const fromId = query.from.id;
        const messageId = query.message.message_id;

        const uuid = query.data.split(" ")[1];
        if (!uuid) return;

        const request = getOllamaRequest(uuid);
        if (!request) return;
        if (request.fromId !== fromId) return;

        const aborted = abortOllamaRequest(uuid);
        console.log(`aborted request ${uuid}:`, aborted);

        await bot.editMessageReplyMarkup({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {inline_keyboard: []}
        }).catch(logError);
    }
}