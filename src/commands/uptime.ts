import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {getUptime, logError, oldSendMessage} from "../util/utils";

export class Uptime extends ChatCommand {
    regexp = /^\/uptime/i;
    title = "/uptime";
    description = "Bot's uptime";

    async execute(msg: Message): Promise<void> {
        await oldSendMessage(msg, getUptime()).catch(logError);
    }
}