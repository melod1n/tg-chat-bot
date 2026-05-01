import {CallbackQuery, Message} from "typescript-telegram-bot-api";
import {CallbackCommand} from "../base/callback-command";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {MessageStore} from "../common/message-store";
import {StoredMessage} from "../model/stored-message";
import {cutPrefixes, logError} from "../util/utils";
import {runUnifiedAi} from "../ai/unified-ai-runner";
import {AI_REGENERATE_CALLBACK, parseAiRegenerateCallbackData} from "../ai/regenerate-callback";
import {resolveEffectiveAiProviderForUser} from "../common/user-ai-settings";
import {Environment} from "../common/environment";

export class AiRegenerate extends CallbackCommand {
    data = AI_REGENERATE_CALLBACK;
    text = Environment.aiRegenerateCallbackText;

    requirements = Requirements.Build(Requirement.SAME_USER);

    async execute(query: CallbackQuery): Promise<void> {
        if (!query.message || !query.data) return;

        const parsed = parseAiRegenerateCallbackData(query.data);
        if (!parsed) return;

        const source = await this.resolveSourceMessage(query);
        if (!source) return;

        const sourceFromId = source.stored?.fromId ?? source.message.from?.id;
        if (!sourceFromId || (sourceFromId !== query.from.id && query.from.id !== Environment.CREATOR_ID)) return;

        const provider =
            // isAiProviderConfigured(parsed.provider)
            // ? parsed.provider
            // :
        await resolveEffectiveAiProviderForUser(source.message.from?.id ?? query.from.id);
        const text = cutPrefixes(source.stored ?? source.message) ?? "";

        runUnifiedAi({
            provider,
            msg: source.message,
            text,
            stream: true,
            think: parsed.think,
            targetMessage: query.message,
        }).catch(logError);
    }

    private async resolveSourceMessage(query: CallbackQuery): Promise<{
        message: Message;
        stored: StoredMessage | null;
    } | null> {
        const responseMessage = query.message;
        if (!responseMessage) return null;

        const directSource = "reply_to_message" in responseMessage ? responseMessage.reply_to_message : undefined;
        if (directSource) {
            const stored = await MessageStore.put(directSource).catch(e => {
                logError(e);
                return null;
            });
            return {message: directSource, stored};
        }

        const storedResponse = await MessageStore.get(responseMessage.chat.id, responseMessage.message_id);
        const storedSource = await MessageStore.get(responseMessage.chat.id, storedResponse?.replyToMessageId);
        if (!storedSource) return null;

        return {
            message: this.storedToMessage(storedSource, responseMessage, query),
            stored: storedSource,
        };
    }

    private storedToMessage(stored: StoredMessage, responseMessage: Message, query: CallbackQuery): Message {
        return {
            message_id: stored.id,
            chat: responseMessage.chat,
            date: stored.date,
            from: query.from.id === stored.fromId
                ? query.from
                : {id: stored.fromId, is_bot: false, first_name: ""},
            text: stored.text ?? undefined,
        } as Message;
    }
}
