import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, randomValue, replyToMessage} from "../util/utils";
import {testAnswers} from "../db/database";

export class Test implements ChatCommand {
    regexp = /^(test|тест|еуые|ntcn|инноке(нтий|ш|нтич))/i;
    title = "тест";
    description = "System functionality check";

    async execute(msg: Message) {
        await replyToMessage(msg, randomValue(testAnswers) || "а").catch(logError);
    }
}