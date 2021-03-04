import {Command} from "./base/command";
import {getRandomInt, MessageContext, testAnswer, testAnswers} from "../base/base";
import {sendMessage} from "../base/net";

export class Test implements Command {

    regexp = /^(test|тест|еуые|ntcn|инноке(нтий|ш|нтич))/i

    async execute(context: MessageContext) {
        if (!testAnswer) return

        const index = getRandomInt(testAnswers.length)
        await sendMessage(context, testAnswers[index])
    }

}