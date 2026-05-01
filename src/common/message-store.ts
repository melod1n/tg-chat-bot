import {StoredMessage} from "../model/stored-message";
import {Message} from "typescript-telegram-bot-api";
import {extractTextMessage, getPhotoMaxSize, isStoredMessage} from "../util/utils";
import {messageDao} from "../index";
import {KeyedAsyncLock} from "../util/async-lock";
import {setLruMapValue} from "../util/lru-map";
import {createStoredImageAttachment} from "./stored-attachment-utils";

const MESSAGE_CACHE_MAX_ENTRIES = 10_000;

export class MessageStore {
    private static map = new Map<string, StoredMessage>();
    private static locks = new KeyedAsyncLock();

    private static key(chatId: number, messageId: number) {
        return `${chatId}:${messageId}`;
    }

    static all(): Map<string, StoredMessage> {
        return this.map;
    }

    static async put(m: Message | StoredMessage): Promise<StoredMessage> {
        const maxSize = isStoredMessage(m) ? null : getPhotoMaxSize(m.photo);

        const msg: StoredMessage = isStoredMessage(m) ? m : {
            chatId: m.chat.id,
            id: m.message_id,
            replyToMessageId: m.reply_to_message?.message_id,
            fromId: <number>m.from?.id,
            text: extractTextMessage(m),
            quoteText: m.quote?.text,
                date: m.date ?? 0,
                deletedByBotAt: undefined,
                attachments: maxSize ? [createStoredImageAttachment({
                    fileId: maxSize.file_id,
                    fileUniqueId: maxSize.file_unique_id,
                    fileName: `${maxSize.file_unique_id || maxSize.file_id}.jpg`,
                })] : undefined,
                pipelineAudit: undefined,
            };

        const key = this.key(msg.chatId, msg.id);
        return this.locks.runExclusive(key, async () => {
            const existing = this.map.get(key) ?? await messageDao.getById({chatId: msg.chatId, id: msg.id});
            const merged: StoredMessage = {
                chatId: msg.chatId,
                id: msg.id,
                replyToMessageId: msg.replyToMessageId ?? existing?.replyToMessageId,
                fromId: msg.fromId,
                text: msg.text !== undefined ? msg.text : existing?.text,
                quoteText: msg.quoteText ? msg.quoteText : existing?.quoteText,
                date: msg.date,
                deletedByBotAt: msg.deletedByBotAt !== undefined ? msg.deletedByBotAt : existing?.deletedByBotAt,
                attachments: msg.attachments !== undefined ? msg.attachments : existing?.attachments,
                pipelineAudit: msg.pipelineAudit !== undefined ? msg.pipelineAudit : existing?.pipelineAudit,
            };

            setLruMapValue(this.map, key, merged, MESSAGE_CACHE_MAX_ENTRIES);
            await messageDao.insert(messageDao.mapStoredTo([merged]));
            return merged;
        });
    }

    static async get(chatId: number, messageId: number | undefined): Promise<StoredMessage | null> {
        if (!messageId) return null;

        const message = await messageDao.getById({chatId: chatId, id: messageId});
        if (!message) return null;

        setLruMapValue(this.map, this.key(message.chatId, messageId), message, MESSAGE_CACHE_MAX_ENTRIES);
        return message;
    }

    static clear() {
        this.map.clear();
    }
}
