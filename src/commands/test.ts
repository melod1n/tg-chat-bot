import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, oldReplyToMessage, randomValue} from "../util/utils";
import {Environment} from "../common/environment";

export class Test extends Command {
    regexp = /^(test|тест|еуые|ntcn|инноке(нтий|ш|нтич))$/i;
    title = Environment.commandTitles.test;
    description = Environment.commandDescriptions.test;

    async execute(msg: Message) {
        await oldReplyToMessage(msg, randomValue(Environment.ANSWERS.test) || Environment.defaultTestAnswerText).catch(logError);
    }
}
