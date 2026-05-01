import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command";
import {isTranscribableAudioDownload, resolveSpeechToTextProviderForUser, transcribeSpeechDownloads} from "../ai/speech-to-text";
import {attachmentsToDownloadedFiles, cacheMessageAttachments} from "../ai/telegram-attachments";
import {MessageStore} from "../common/message-store";
import {StoredAttachment} from "../model/stored-attachment";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {parseProviderToken} from "../ai/provider-aliases";

const TELEGRAM_LIMIT = 4096;

async function collectStoredAttachments(msg: Message | undefined): Promise<StoredAttachment[]> {
    if (!msg) return [];

    const stored = await MessageStore.get(msg.chat.id, msg.message_id);
    if (stored?.attachments?.length) return stored.attachments;

    return cacheMessageAttachments(msg);
}

async function collectAudioDownloads(msg: Message) {
    const attachments = [
        ...await collectStoredAttachments(msg),
        ...await collectStoredAttachments(msg.reply_to_message),
    ];
    const seen = new Set<string>();

    return attachmentsToDownloadedFiles(attachments)
        .filter(isTranscribableAudioDownload)
        .filter(download => {
            const key = `${download.fileId}:${download.path}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

export class SpeechToText extends Command {
    command = ["stt", "transcribe"];
    argsMode = "optional" as const;

    title = Environment.commandTitles.speechToText;
    description = Environment.commandDescriptions.speechToText;

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        if (!msg.from) return;

        const args = match?.[3]?.trim() ?? "";
        const explicitProvider = parseProviderToken(args.split(/\s+/)[0]);
        const downloads = await collectAudioDownloads(msg);

        if (!downloads.length) {
            await replyToMessage({
                message: msg,
                text: Environment.speechToTextInstructionText,
            }).catch(logError);
            return;
        }

        try {
            const resolved = await resolveSpeechToTextProviderForUser(msg.from.id, explicitProvider, {
                allowFallback: !explicitProvider,
            });
            const transcript = await transcribeSpeechDownloads(resolved.provider, downloads);
            const text = transcript.trim() || Environment.speechToTextEmptyResultText;

            await replyToMessage({
                message: msg,
                text: text.length > TELEGRAM_LIMIT ? text.slice(0, TELEGRAM_LIMIT - 3) + "..." : text,
            }).catch(logError);
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
            await replyToMessage({
                message: msg,
                text: e instanceof Error ? e.message : String(e),
            }).catch(logError);
        }
    }
}
