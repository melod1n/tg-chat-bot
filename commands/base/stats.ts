import {Command} from "./command";
import {getUptime, MessageContext, messagesReceived, messagesSent} from "../../base/base";
import {sendMessage} from "../../base/net";

export class Stats implements Command {
    regexp = /^\/stats/i
    title: '/stats'
    description: 'статистика бота'

    async execute(context: MessageContext) {
        const text = `Статистика бота.\n\n⏳ Время работы: ${getUptime()}\n📥 Сообщений получено: ${messagesReceived}\n📤 Сообщений отправлено: ${messagesSent}`
        await sendMessage(context, text)
    }

}