import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {chatCommands} from "../index";
import {Help} from "./help";

export class Start extends ChatCommand {
    regexp = /^\/start/i;
    title = "/start";
    description = "Start the bot";

    async execute(msg: Message): Promise<void> {
        await chatCommands.find(e => e instanceof Help).execute(msg);
    }
}