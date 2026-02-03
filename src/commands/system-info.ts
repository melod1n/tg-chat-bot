import {Command} from "../base/command";
import {logError, replyToMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";

export class SystemInfo extends Command {
    title = "/systemInfo";
    description = "System information";

    private static systemInfoText: string;

    static setSystemInfo(info: string) {
        SystemInfo.systemInfoText = info;
    }

    async execute(msg: Message) {
        await replyToMessage({message: msg, text: SystemInfo.systemInfoText}).catch(logError);
    }
}