import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {logError, replyToMessage} from "../util/utils";

export class Debug extends ChatCommand {
    title = "/debug";
    description = "Returns msg (or reply) as json";

    requirements = Requirements.Build(Requirement.BOT_ADMIN);

    async execute(msg: Message): Promise<void> {
        const msgToDebug = msg.reply_to_message ? msg.reply_to_message : msg;

        const json = JSON.stringify(msgToDebug, null, 2);
        const text = `\`\`\`json\n${json}\n\`\`\``;
        await replyToMessage({message: msg, text: text, parse_mode: "Markdown"}).catch(logError);
    }
}