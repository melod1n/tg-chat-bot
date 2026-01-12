import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, randomValue} from "../util/utils";
import {bot} from "../index";

type DiceEmoji = "🎲" | "🎯" | "🏀" | "⚽" | "🎳" | "🎰";
const emojis = ["🎲", "🎯", "🏀", "⚽", "🎳", "🎰"];

export class Dice extends ChatCommand {
    regexp = /^\/dice/i;
    title = "/dice [emoji]";
    description = "Sends random or specific dice";

    async execute(msg: Message): Promise<void> {
        const split = msg.text.split("/dice ");
        const secondPart = split[1]?.trim();
        const emojiIndex = emojis.indexOf(secondPart);
        const emojiToDice: DiceEmoji = (emojiIndex >= 0 ? emojis[emojiIndex] : randomValue(emojis)) as DiceEmoji;

        await bot.sendDice({
            chat_id: msg.chat.id,
            emoji: emojiToDice,
            reply_parameters: {
                message_id: msg.message_id
            }
        }).catch(logError);
    }
}