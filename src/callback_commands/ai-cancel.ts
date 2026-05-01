import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery, InlineKeyboardMarkup, Message} from "typescript-telegram-bot-api";
import {abortAiRequest, getAiCancelRequest} from "../ai/cancel-registry";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {MessageStore} from "../common/message-store";
import {bot} from "../index";
import {buildCancelledGenerationText, logError} from "../util/utils";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {prepareTelegramMarkdownV2} from "../util/markdown-v2-renderer";
import {buildAiRegenerateCallbackData} from "../ai/regenerate-callback";
import {isAiProviderConfigured, resolveEffectiveAiProviderForUser} from "../common/user-ai-settings";

const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

export class AiCancel extends CallbackCommand {
    data = "/cancel_ai";
    text = Environment.aiCancelCallbackText;

    requirements = Requirements.Build(Requirement.SAME_USER);

    async execute(query: CallbackQuery): Promise<void> {
        if (!query.message || !query.data) return;

        const parsed = this.parseCallbackData(query.data);
        if (!parsed) return;

        const request = getAiCancelRequest(parsed.requestId);
        if (!request) {
            await this.markMessageAsCancelled(query, parsed.provider);
            return;
        }
        if (request.fromId !== query.from.id && query.from.id !== Environment.CREATOR_ID) return;

        const cancelled = await abortAiRequest(parsed.requestId);
        if (!cancelled) return;
    }

    private parseCallbackData(data: string): { requestId: string; provider?: AiProvider } | null {
        const [, requestId, provider] = data.split(/\s+/);
        if (!requestId) return null;

        return {
            requestId,
            provider: Object.values(AiProvider).includes(provider as AiProvider) ? provider as AiProvider : undefined,
        };
    }

    private async markMessageAsCancelled(query: CallbackQuery, providerFromCallback?: AiProvider): Promise<void> {
        const callbackMessage = query.message;
        if (!callbackMessage || callbackMessage.date === 0) return;
        const message = callbackMessage as Message;

        const stored = await MessageStore.get(message.chat.id, message.message_id).catch(e => {
            logError(e);
            return null;
        });
        const sourceFromId = await this.resolveSourceFromId(message, stored).catch(e => {
            logError(e);
            return undefined;
        });
        const regenerateProvider = providerFromCallback && isAiProviderConfigured(providerFromCallback)
            ? providerFromCallback
            : await resolveEffectiveAiProviderForUser(sourceFromId ?? query.from.id);
        const providerName = (providerFromCallback ?? regenerateProvider).toLowerCase();
        const isCaption = this.isCaptionMessage(message);
        const limit = isCaption ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT;
        const baseText = stored?.text ?? message.text ?? message.caption ?? "";
        const cancelledText = buildCancelledGenerationText(baseText, providerName, limit);
        const replyMarkup = this.regenerateKeyboard(regenerateProvider);
        const formatted = prepareTelegramMarkdownV2(cancelledText, {mode: "final"});
        const deletedByBotAt = Math.floor(Date.now() / 1000);

        try {
            await enqueueTelegramApiCall(
                () => isCaption
                    ? bot.editMessageCaption({
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        caption: formatted,
                        parse_mode: "MarkdownV2",
                        reply_markup: replyMarkup,
                    })
                    : bot.editMessageText({
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        text: formatted,
                        parse_mode: "MarkdownV2",
                        reply_markup: replyMarkup,
                    }),
                {method: isCaption ? "editMessageCaption" : "editMessageText", chatId: message.chat.id, chatType: message.chat.type}
            );

            await MessageStore.put({
                chatId: message.chat.id,
                id: message.message_id,
                replyToMessageId: stored?.replyToMessageId ?? this.replyToMessageId(message),
                fromId: message.from?.id ?? stored?.fromId ?? 0,
                text: cancelledText,
                quoteText: stored?.quoteText,
                date: message.date ?? stored?.date ?? deletedByBotAt,
                deletedByBotAt,
                attachments: stored?.attachments,
            });
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
        }
    }

    private regenerateKeyboard(provider: AiProvider): InlineKeyboardMarkup {
        return {
            inline_keyboard: [[{
                text: Environment.regenerateText,
                callback_data: buildAiRegenerateCallbackData(provider),
            }]],
        };
    }

    private async resolveSourceFromId(message: Message, stored: Awaited<ReturnType<typeof MessageStore.get>>): Promise<number | undefined> {
        const reply = "reply_to_message" in message ? message.reply_to_message : undefined;
        if (reply?.from?.id) return reply.from.id;

        const source = await MessageStore.get(message.chat.id, stored?.replyToMessageId);
        return source?.fromId;
    }

    private replyToMessageId(message: Message): number | undefined {
        return "reply_to_message" in message ? message.reply_to_message?.message_id : undefined;
    }

    private isCaptionMessage(message: Message): boolean {
        return message.caption !== undefined;
    }
}
