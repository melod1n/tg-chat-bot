import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {commands} from "../index";
import {Help} from "./help";

export class Start extends Command {
    title = "/start";
    description = "Start the bot";

    async execute(msg: Message): Promise<void> {
        await commands.find(e => e instanceof Help).execute(msg);
    }
}