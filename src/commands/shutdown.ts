import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {bot, shutdown as shutdownApp} from "../index";
import {delay, logError, randomValue} from "../util/utils";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {Environment} from "../common/environment";

const timings = [1500, 2500];
const timer = [3, 2, 1];

export class Shutdown extends Command {
    title = Environment.commandTitles.shutdown;
    description = Environment.commandDescriptions.shutdown;

    argsMode = "optional" as const;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray): Promise<void> {
        const send = async (text: string) => {
            await enqueueTelegramApiCall(
                () => bot.sendMessage({chat_id: msg.chat.id, text}),
                {method: "sendMessage", chatId: msg.chat.id, chatType: msg.chat.type}
            ).catch(logError);
        };

        await send(Environment.shutdownFallbackText);

        const now = match?.[3]?.toLowerCase() === "now";
        if (msg.chat.type !== "private" && !now) {
            for (const text of Environment.shutdownSequenceTexts) {
                await delay(randomValue(timings) ?? 1500);
                await send(text);
            }

            await delay(randomValue(timings) ?? 1500);

            for (const t of timer) {
                await send(`${t}`);
                await delay(1000);
            }
        }

        await send(Environment.shutdownDoneText);

        await delay(2000);
        await shutdownApp("manual");
    }
}
