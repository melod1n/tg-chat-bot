import {Command} from "./base/command";
import {MessageContext, systemSpecsText} from "../base/base";
import {sendMessage} from "../base/net";

export class SystemSpecs implements Command {

    regexp = /^\/systemspecs/i

    async execute(context: MessageContext) {
        await sendMessage(context, systemSpecsText)
    }

}