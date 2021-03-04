import {Command} from "./base/command";
import {sendMessage} from "../base/net";
import {MessageContext} from "../base/base";

export class Q implements Command {
    regexp = /^(\/q|умри)/i
    title: '/q or умри'
    requireAdmin: true

    async execute(context: MessageContext, params: string[], reply: MessageContext) {
        await sendMessage(context, 'пака')

        process.exit()
    }

}