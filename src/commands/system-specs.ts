import {ChatCommand} from "../base/chat-command";
import {logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {systemSpecsText} from "../index";

export class SystemSpecs implements ChatCommand {
    regexp = /^\/systemspecs/i;
    title = "/systemSpecs";
    description = "System specifications of system";

    async execute(msg: Message) {
        await oldSendMessage(msg, systemSpecsText).catch(logError);
    }
}