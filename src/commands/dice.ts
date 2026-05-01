import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, randomValue} from "../util/utils";
import {bot} from "../index";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {Environment} from "../common/environment";

type DiceEmoji = "🎲" | "🎯" | "🏀" | "⚽" | "🎳" | "🎰";
const emojis: readonly DiceEmoji[] = ["🎲", "🎯", "🏀", "⚽", "🎳", "🎰"];

export class Dice extends Command {
    title = Environment.commandTitles.dice;
    description = Environment.commandDescriptions.dice;

    async execute(msg: Message): Promise<void> {
        const split = msg.text?.split("/dice ");
        const secondPart = split?.[1]?.trim() || "";
        const requestedEmoji = secondPart as DiceEmoji;
        const emojiToDice = emojis.includes(requestedEmoji) ? requestedEmoji : randomValue(emojis) ?? "🎲";

        await enqueueTelegramApiCall(
            () => bot.sendDice({
                chat_id: msg.chat.id,
                emoji: emojiToDice,
                reply_parameters: {
                    message_id: msg.message_id
                }
            }),
            {method: "sendDice", chatId: msg.chat.id, chatType: msg.chat.type}
        ).catch(logError);
    }
}
