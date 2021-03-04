import {Command} from "./base/command";
import {checkMom, MessageContext} from "../base/base";
import {sendMessage} from "../base/net";

export class Mom implements Command {
    regexp = /ма(ма|му|ть|ы|ой)/i
    title: 'мать'

    async execute(context: MessageContext) {
        if (!checkMom) return

        await sendMessage(context, 'мать не трож')
    }
}