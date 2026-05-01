import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, oldReplyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class Id extends Command {
    title = Environment.commandTitles.id;
    description = Environment.commandDescriptions.id;

    async execute(msg: Message): Promise<void> {
        await oldReplyToMessage(
            msg,
            Environment.getIdText(msg.chat.id, msg.from?.id, msg.reply_to_message?.from?.id),
            "MarkdownV2",
        ).catch(logError);
    }
}
