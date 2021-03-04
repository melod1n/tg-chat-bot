import {Command} from "./base/command";
import {addMute} from "../base/db";
import {sendMessage} from "../base/net";
import {MessageContext} from "../base/base";

export class Mute implements Command {
    regexp = /^\/mute/i
    title: '/mute'
    description: 'игнор участника со стороны бота'
    requireAdmin: true

    async execute(context: MessageContext, params: string[], reply: MessageContext) {
        if (!reply) return

        const id = context.repliedMessage.senderId

        const text = context.repliedMessage.getFullSenderTitle()

        if (addMute(id)) {
            await sendMessage(context, text + ' в муте! 🚫')
        } else {
            await sendMessage(context, text + ' уже в муте 🤔')
        }
    }
}