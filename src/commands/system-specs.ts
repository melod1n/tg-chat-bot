import {ChatCommand} from "../base/chat-command";
import {logError, oldSendMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {systemInfoText} from "../index";

export class SystemSpecs implements ChatCommand {
    regexp = /^\/systeminfo/i;
    title = "/systemInfo";
    description = "System information";

    async execute(msg: Message) {
        await oldSendMessage(msg, systemInfoText).catch(logError);
    }
}