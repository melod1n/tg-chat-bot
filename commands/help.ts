import {Command} from "./base/command";
import {MessageContext} from "../base/base";
import {sendMessage} from "../base/net";

export class Help implements Command {
    regexp = /^\/help/i
    title: '/help'
    description: 'help'

    async execute(context: MessageContext) {
        const text = "Все вопросы к @melodaaa"
        return sendMessage(context, text)
    }



}