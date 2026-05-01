import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {getUptime, logError, oldSendMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class Uptime extends Command {
    title = Environment.commandTitles.uptime;
    description = Environment.commandDescriptions.uptime;

    async execute(msg: Message): Promise<void> {
        await oldSendMessage(msg, getUptime()).catch(logError);
    }
}
