import {Command} from "./base/command";
import {biteDick, MessageContext} from "../base/base";
import {sendMessage} from "../base/net";

export class FuckYou implements Command {
    regexp = /(иди|пош([её])л)\s(нахуй|на\sхуй)/i
    title: 'иди нахуй'

    async execute(context: MessageContext) {
        if (!biteDick) return

        await sendMessage(context, 'кусай за хуй')
    }
}