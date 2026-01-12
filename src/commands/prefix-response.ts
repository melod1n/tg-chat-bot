import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, randomValue, replyToMessage} from "../util/utils";
import {prefixAnswers} from "../db/database";

export class PrefixResponse extends ChatCommand {
    regexp: RegExp;

    async execute(msg: Message): Promise<void> {
        await replyToMessage(msg, randomValue(prefixAnswers)).catch(logError);
    }
}