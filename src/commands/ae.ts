import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {errorPlaceholder, logError, oldSendMessage} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";

export class Ae implements ChatCommand {
    regexp = /^\/ae\s([^]+)/i;
    title = "/ae";
    description = "evaluation";

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, params: string[]) {
        const match = params[1];

        try {
            let e = eval(match);

            e = ((typeof e == "string") ? e : JSON.stringify(e));

            await oldSendMessage(msg, e).catch(async () => await errorPlaceholder(msg));
        } catch (e) {
            const text = e.message.toString();

            if (text.includes("is not defined")) {
                await oldSendMessage(msg, "variable is not defined").catch(logError);
                return;
            }

            console.error(`${text}
                * Stacktrace: ${e.stack}`);

            await oldSendMessage(msg, text).catch(logError);
        }
    }
}