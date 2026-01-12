import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "./requirements";

export abstract class ChatCommand {

    abstract regexp: RegExp;
    requirements?: Requirements = null;
    title?: string;
    description?: string;

    abstract execute(
        msg: Message,
        match?: RegExpExecArray
    ): Promise<void>;
}