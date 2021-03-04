import {Command} from "./base/command";
import {removeMute} from "../base/db";
import {sendMessage} from "../base/net";
import {MessageContext} from "../base/base";

export class Unmute implements Command {
    regexp = /^\/unmute/i
    title: '/unmute'
    description: 'удаление из мут листа'
    requireAdmin: true

    async execute(context: MessageContext, params: string[], reply: MessageContext) {
        if (!reply) return

        const id = context.repliedMessage.senderId

        const text = context.repliedMessage.getFullSenderTitle()

        if (removeMute(id)) {
            await sendMessage(context, text + ' больше не в муте! 😁')
        } else {
            await sendMessage(context, text + ' не был в муте 🤔')
        }
    }
}