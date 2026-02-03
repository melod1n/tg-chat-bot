import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, oldReplyToMessage} from "../util/utils";

export class Id extends Command {
    title = "/id";
    description = "ID of chat, user and reply (if replied to any message)";

    async execute(msg: Message): Promise<void> {
        let text = `chat id: \n\`\`\`${msg.chat.id}\`\`\` \nfrom id: \n\`\`\`${msg.from.id}\`\`\``;
        if (msg.reply_to_message) {
            text += ` \nreply id: \n\`\`\`${msg.reply_to_message.from.id}\`\`\``;
        }

        await oldReplyToMessage(msg, text, "MarkdownV2").catch(logError);
    }
}