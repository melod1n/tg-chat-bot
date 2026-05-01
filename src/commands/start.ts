import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {commands} from "../index";
import {Help} from "./help";
import {Environment} from "../common/environment";

export class Start extends Command {
    title = Environment.commandTitles.start;
    description = Environment.commandDescriptions.start;

    async execute(msg: Message): Promise<void> {
        await commands.find(e => e instanceof Help)?.execute(msg);
    }
}
