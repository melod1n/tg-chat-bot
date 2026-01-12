import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";

export class Id extends ChatCommand {
    regexp = /^\/id/i;
    title = "/id";
    description = "ID of chat, user and reply (if replied to any message)";

    async execute(msg: Message): Promise<void> {
        let text = `chat id: \n\`\`\`${msg.chat.id}\`\`\` \nfrom id: \n\`\`\`${msg.from.id}\`\`\``;
        if (msg.reply_to_message) {
            text += ` \nreply id: \n\`\`\`${msg.reply_to_message.from.id}\`\`\``;
        }

        await replyToMessage(msg, text, "MarkdownV2").catch(logError);
    }
}