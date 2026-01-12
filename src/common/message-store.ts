import {StoredMessage} from "../model/stored-message";
import {Message} from "typescript-telegram-bot-api";
import {extractTextMessage} from "../util/utils";
import {Environment} from "./environment";
import {messageDao} from "../index";

export class MessageStore {
    private static map = new Map<string, StoredMessage>();

    private static key(chatId: number, messageId: number) {
        return `${chatId}:${messageId}`;
    }

    static all(): Map<string, StoredMessage> {
        return this.map;
    }

    static async put(m: Message, prefix: string = Environment.BOT_PREFIX) {
        const msg: StoredMessage = {
            chatId: m.chat.id,
            messageId: m.message_id,
            replyToMessageId: m.reply_to_message?.message_id ?? null,
            fromId: m.from.id,
            text: extractTextMessage(m, prefix),
            date: m.date ?? 0,
        };

        this.map.set(this.key(m.chat.id, m.message_id), msg);

        await messageDao.insert(messageDao.mapTo([m]));
    }

    static async get(chatId: number, messageId: number): Promise<StoredMessage | null> {
        const message = await messageDao.getById({chatId: chatId, id: messageId});
        if (!message) return null;

        this.map.set(this.key(message.chatId, messageId), message);
        return message;
    }

    static clear() {
        this.map.clear();
    }
}