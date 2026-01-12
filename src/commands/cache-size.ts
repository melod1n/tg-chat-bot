import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, sendMessage} from "../util/utils";
import {MessageStore} from "../common/message-store";

export class CacheSize extends ChatCommand {
    regexp = /^\/cachesize$/i;

    async execute(msg: Message): Promise<void> {
        const cacheSize = MessageStore.all();

        await sendMessage({
            chatId: msg.chat.id,
            text: `Количество сохранённых сообщений: ${cacheSize.size}`
        }).catch(logError);
    }
}