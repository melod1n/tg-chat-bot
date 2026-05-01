import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command";
import {parseProviderToken} from "../ai/provider-aliases";
import {
    resolveTextToSpeechProviderForUser,
    sendSynthesizedSpeech,
    synthesizeSpeech,
} from "../ai/text-to-speech";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class TextToSpeech extends Command {
    command = ["tts", "say", "voice"];
    argsMode = "optional" as const;

    title = Environment.commandTitles.textToSpeech;
    description = Environment.commandDescriptions.textToSpeech;

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        if (!msg.from) return;

        const args = match?.[3]?.trim() ?? "";
        const replyText = (msg.reply_to_message?.text ?? msg.reply_to_message?.caption ?? "").trim();
        const [firstToken = "", ...restTokens] = args.split(/\s+/);
        const explicitProvider = parseProviderToken(firstToken);
        const text = explicitProvider
            ? (restTokens.join(" ").trim() || replyText)
            : (args || replyText);

        if (!text.trim()) {
            await replyToMessage({
                message: msg,
                text: Environment.textToSpeechInstructionText,
            }).catch(error => logError(error instanceof Error ? error : String(error)));
            return;
        }

        try {
            const resolved = await resolveTextToSpeechProviderForUser(msg.from.id, explicitProvider);
            const speech = await synthesizeSpeech({provider: resolved.provider, text});
            await sendSynthesizedSpeech(msg, speech);
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
            await replyToMessage({
                message: msg,
                text: e instanceof Error ? e.message : String(e),
            }).catch(logError);
        }
    }
}
