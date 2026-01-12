import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {MessageStore} from "../common/message-store";
import {logError, sendMessage} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";

export class CacheClear extends ChatCommand {
    regexp = /^\/clearcache$/i;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        const size = MessageStore.all().size;
        MessageStore.clear();
        await sendMessage({chatId: msg.chat.id, text: `Было удалено сообщений: ${size}`}).catch(logError);
    }
}