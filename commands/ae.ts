import {Command} from "./base/command";
import {sendMessage} from "../base/net";
import {MessageContext} from "../base/base";

export class Ae implements Command {
    regexp = /^\/ae\s([^]+)/i
    title: '/ae'
    description: 'eval'
    requireAdmin: true

    async execute(context: MessageContext, params: string[]) {
        const match = params[1]

        try {
            let e = eval(match)

            e = ((typeof e == 'string') ? e : JSON.stringify(e))

            await sendMessage(context, e)
        } catch (e) {
            const text = e.message.toString()

            if (text.includes('is not defined')) {
                await sendMessage(context, 'variable is not defined')
                return
            }

            console.error(`${text}
                * Stacktrace: ${e.stack}`)

            await sendMessage(context, text)
        }
    }
}