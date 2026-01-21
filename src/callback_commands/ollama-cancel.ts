import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery} from "typescript-telegram-bot-api";
import {abortOllamaRequest, bot, getOllamaRequest} from "../index";
import {Environment} from "../common/environment";
import {logError} from "../util/utils";
import {MessageStore} from "../common/message-store";
import {StoredMessage} from "../model/stored-message";

const cancelledText = "```Ollama\n❌ Отменено```";

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
        if (request) {
            if (request.fromId !== fromId && fromId !== Environment.CREATOR_ID) return;

            const aborted = abortOllamaRequest(uuid);
            console.log(`aborted request ${uuid}:`, aborted);
        }

        let msg: StoredMessage | null = null;
        try {
            msg = await MessageStore.get(chatId, messageId);
        } catch (e) {
            logError(e);
        }

        let content: string | null = null;

        if (msg?.text?.trim()?.length > 0) {
            content = msg?.text.trim();
            if (content.length + cancelledText.length > 4096) {
                content = content.substring(0, 4096 - cancelledText.length - 2) + "\n";
            }
        }

        await bot.editMessageText({
            chat_id: chatId,
            message_id: messageId,
            text: `${content}${cancelledText}`,
            parse_mode: "Markdown",
            reply_markup: {inline_keyboard: []},
        }).catch(logError);
    }
}