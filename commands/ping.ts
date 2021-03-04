import {Command} from "./base/command";
import {MessageContext, setStartTime, startTime} from "../base/base";
import {sendMessage} from "../base/net";

export class Ping implements Command {
    regexp = /^\/ping/i
    title: '/ping'
    description: 'задержа между получаемым сообщением и отправленным'

    async execute(context: MessageContext) {
        await sendMessage(context, 'pong').then(async () => {
            const nowMillis = new Date().getMilliseconds()

            const change = Math.abs(nowMillis - startTime)
            await sendMessage(context, `ping: ${change} ms`).then(() => {
                setStartTime(0)
            })
        })
    }


}