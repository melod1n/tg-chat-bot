import {Command} from "./base/command";
import {checkDad, MessageContext} from "../base/base";
import {sendMessage} from "../base/net";

export class Dad implements Command {
    regexp = /бат(ь|я|ька|ёк)/i
    title: 'бать'

    async execute(context: MessageContext) {
        if (!checkDad) return

        await sendMessage(context, 'ща втащу')
    }
}