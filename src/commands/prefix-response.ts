import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, randomValue, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class PrefixResponse extends Command {
    async execute(msg: Message): Promise<void> {
        await replyToMessage({message: msg, text: randomValue(Environment.ANSWERS.prefix)}).catch(logError);
    }
}