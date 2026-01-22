import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot} from "../index";
import {delay, logError, randomValue} from "../util/utils";

const texts = [
    "ну что-же, господа",
    "приятно было с вами пообщаться",
    "но мне пора на покой",
    "всего хорошего"
];

const timings = [1500, 2500];
const timer = [3, 2, 1];

export class Shutdown extends ChatCommand {
    title = "/shutdown";
    description = "Self-destruction sequence for bot (shutdown)";

    argsMode = "optional" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        await bot.sendMessage({chat_id: msg.chat.id, text: "..."}).catch(logError);

        const now = match?.[3]?.toLowerCase() === "now";
        if (msg.chat.type !== "private" && !now) {
            for (const text of texts) {
                await delay(randomValue(timings));
                await bot.sendMessage({chat_id: msg.chat.id, text: text}).catch(logError);
            }

            await delay(randomValue(timings));

            for (const t of timer) {
                await bot.sendMessage({chat_id: msg.chat.id, text: `${t}`}).catch(logError);
                await delay(1000);
            }
        }

        await bot.sendMessage({chat_id: msg.chat.id, text: "*R.I.P*"}).catch(logError);

        delay(2000).then(() => process.exit(0));
    }
}