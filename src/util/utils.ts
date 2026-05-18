import * as si from "systeminformation";
import {appLogger} from "../logging/logger.js";
import {Command} from "../base/command.js";
import {CallbackCommand} from "../base/callback-command.js";
import {
    CallbackQuery,
    ChatMember,
    ChatMemberUpdated,
    InlineKeyboardMarkup,
    InlineQuery,
    InlineQueryResult,
    Message,
    ParseMode,
    PhotoSize,
    TelegramBot,
    User
} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment.js";
import {TelegramError} from "typescript-telegram-bot-api/dist/errors.js";
import {bot, botUser, callbackCommands, commands, messageDao, photoDir} from "../index.js";
import os from "os";
import axios from "axios";
import {MessageAudioPart, MessageImagePart, MessagePart} from "../common/message-part.js";
import {StoredMessage} from "../model/stored-message.js";
import sharp from "sharp";
import {UserStore} from "../common/user-store.js";
import fs from "node:fs";
import path from "node:path";
import {MessageStore} from "../common/message-store.js";
import {filterUserInputStoredAttachments} from "../common/attachment-visibility.js";
import {SystemInfo} from "../commands/system-info.js";
import {PrefixResponse} from "../commands/prefix-response.js";
import {ChatCommand} from "../base/chat-command.js";
import {AiProvider} from "../model/ai-provider.js";
import {SendOptions} from "../model/send-options.js";
import {EditOptions} from "../model/edit-options.js";
import {StoredUser} from "../model/stored-user.js";
import {StoredAttachment} from "../model/stored-attachment.js";
import {AiDownloadedFile} from "../ai/telegram-attachments.js";
import {runUnifiedAi} from "../ai/unified-ai-runner.js";
import {enqueueTelegramApiCall} from "./telegram-api-queue.js";
import {AsyncSemaphore, KeyedAsyncLock} from "./async-lock.js";
import {resolveEffectiveAiProviderForUser, resolveInterfaceLocaleForUser} from "../common/user-ai-settings.js";
import {Localization} from "../common/localization.js";
import {createOllamaClient, resolveAiRuntimeTarget} from "../ai/ai-runtime-target.js";
import {RandomUtils} from "./random-utils.js";
import {HtmlUtils} from "./html-utils.js";
import {ShellCommandResult, ShellCommandRunner} from "./shell-command-runner.js";
import type {BoundaryValue, ErrorLike} from "../common/boundary-types.js";
import {createStoredImageAttachment, photoCachePathForUniqueId, uniqueStoredAttachments} from "../common/stored-attachment-utils.js";
import {runTelegramMessageAttachmentPipeline} from "../ai/user-request-pipeline/index.js";

const imageProcessingSemaphore = new AsyncSemaphore(2);
const fileWriteLocks = new KeyedAsyncLock();
const logger = appLogger.child("utils");
const requirementLogger = appLogger.child("requirements");
const messageLogger = appLogger.child("messages");

export const ignore = () => {
};

export const ignoreIfNotChanged = (e: Error | TelegramError) => {
    if (!(e instanceof TelegramError && e?.response?.description?.startsWith("Bad Request: message is not modified"))) {
        throw e;
    }
};

export const ignoreIfMarkupFailed = (e: Error | TelegramError) => {
    if (!isMarkupFailed(e)) {
        throw e;
    }
};

export const logError = (error: Error | TelegramError | string | BoundaryValue | ErrorLike | null | undefined) => {
    appLogger.error("error", {error: error instanceof Error ? error : String(error)});
};

export const errorPlaceholder = async (msg: Message) => {
    await sendErrorPlaceholder(msg).catch(logError);
};

export const isMarkupFailed = (e: Error | TelegramError) => {
    return TelegramBot.isTelegramError(e) && e?.response?.description?.startsWith("Bad Request: can't parse entities");
};

export const isTooManyRequests = (e: Error | TelegramError) => {
    return TelegramBot.isTelegramError(e) && e.response.description.includes("Too Many Requests");
};

export const isMessageTooLong = (e: Error | TelegramError) => {
    return TelegramBot.isTelegramError(e) && e.response.description.includes("MESSAGE_TOO_LONG");
};

export function searchChatCommand(
    commands: Command[],
    text: string,
    botUsername: string | undefined = botUser.username
): Command | null {
    for (const command of commands) {
        const finalRegexp = command.finalRegexp;
        const match = finalRegexp.exec(text);
        if (!match) continue;

        const mentioned = match[2]?.toLowerCase();
        if (botUsername && mentioned && mentioned !== botUsername.toLowerCase()) {
            continue;
        }

        return command;
    }

    return null;
}

export function searchCallbackCommand(commands: CallbackCommand[], data: string): CallbackCommand | null {
    for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        if (!command?.data) continue;
        if (data.startsWith(command.data)) {
            return command;
        }
    }

    return null;
}

export async function checkRequirements(cmd: Command | CallbackCommand | null, msg?: Message, cb?: CallbackQuery): Promise<boolean> {
    if (!cmd) return false;
    if (!msg && !cb) return false;

    const isChatCommand = "title" in cmd;
    const isCallbackCommand = "data" in cmd;
    let title: string;

    if (isChatCommand) {
        title = cmd.title || "";
    } else if (isCallbackCommand) {
        title = cmd.data;
    } else {
        return false;
    }

    const cbId = cb?.id;
    const chatId = msg?.chat?.id || cb?.message?.chat?.id || -1;
    const messageId = msg?.message_id || cb?.message?.message_id || -1;
    const fromId = msg?.from?.id || cb?.from?.id || -1;
    const chatType = msg?.chat?.type || cb?.message?.chat?.type || null;

    if (chatId === -1 || messageId === -1 || fromId === -1 || !chatType) return false;

    if (Environment.ONLY_FOR_CREATOR_MODE && fromId !== Environment.CREATOR_ID) return false;

    if (Environment.CHAT_IDS_WHITELIST.size > 0 &&
        !Environment.CHAT_IDS_WHITELIST.has(chatId) &&
        !Environment.ADMIN_IDS.has(chatId) &&
        !Environment.ADMIN_IDS.has(fromId)) {
        requirementLogger.debug("rejected.chat_whitelist", {title, chatId, fromId});
        return false;
    }

    const reqs = cmd.requirements;
    if (!reqs) return true;

    const notifyUser = async (text: string) => {
        if (msg) {
            await replyToMessage({chat_id: chatId, message_id: messageId, text: text});
        } else if (cb) {
            await enqueueTelegramApiCall(
                () => bot.answerCallbackQuery({
                    callback_query_id: cbId || "",
                    text: text,
                    cache_time: 0,
                    show_alert: true
                }),
                {method: "answerCallbackQuery", skipPerChatLimit: true}
            ).catch(logError);
        }
    };

    if (reqs.isRequiresBotCreator() && fromId !== Environment.CREATOR_ID) {
        requirementLogger.debug("rejected.creator", {title, fromId});
        await notifyUser(Environment.notBotCreatorText);
        return false;
    }

    if (reqs.isRequiresBotAdmin() && !Environment.ADMIN_IDS.has(fromId)) {
        requirementLogger.debug("rejected.bot_admin", {title, fromId});
        await notifyUser(Environment.notBotAdministratorText);
        return false;
    }

    if (reqs.isRequiresChat() && msg?.chat?.type === "private") {
        requirementLogger.debug("rejected.chat_required", {title, chatId, chatType});
        await notifyUser(Environment.notAChatText);
        return false;
    }

    if (reqs.isRequiresChatAdmin()) {
        const member = await bot.getChatMember({chat_id: chatId, user_id: fromId});

        if (!isMemberAdmin(member)) {
            requirementLogger.debug("rejected.chat_admin", {title, chatId, fromId});
            await notifyUser(Environment.notChatAdministratorText);
            return false;
        }
    }

    if (reqs.isRequiresBotChatAdmin() && chatType !== "private") {
        const member = await bot.getChatMember({chat_id: chatId, user_id: botUser.id});

        if (!isMemberAdmin(member)) {
            requirementLogger.debug("rejected.bot_chat_admin", {title, chatId});
            await notifyUser(Environment.botNotChatAdministratorText);
            return false;
        }
    }

    if (reqs.isRequiresReply() && !msg?.reply_to_message) {
        requirementLogger.debug("rejected.reply_required", {title, chatId, messageId});
        await notifyUser(Environment.replyRequiredText);
        return false;
    }

    if (reqs.isRequiresSameUser()) {
        let originalFromId: number | undefined;
        try {
            if (cb?.message) {
                const replyMessage = "reply_to_message" in cb.message ? cb.message.reply_to_message : undefined;
                originalFromId = replyMessage?.from?.id;

                if (!originalFromId && replyMessage?.message_id) {
                    const originalMessage = await MessageStore.get(chatId, replyMessage.message_id);
                    originalFromId = originalMessage?.fromId;
                }

                if (!originalFromId) {
                    const callbackMessage = await MessageStore.get(chatId, cb.message.message_id);
                    const originalMessage = await MessageStore.get(chatId, callbackMessage?.replyToMessageId);
                    originalFromId = originalMessage?.fromId;
                }
            } else {
                const originalMessage = await MessageStore.get(chatId, messageId);
                originalFromId = originalMessage?.fromId;
            }
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
            originalFromId = undefined;
        }

        if (!originalFromId || (fromId !== originalFromId && fromId !== Environment.CREATOR_ID)) {
            requirementLogger.debug("rejected.same_user", {title, chatId, fromId, originalFromId});
            await notifyUser(Environment.onlyOriginalAuthorText);
            return false;
        }
    }

    return true;
}

export async function executeChatCommand(cmd: Command | null, msg: Message, text: string): Promise<boolean> {
    if (!cmd) return false;

    if (!await checkRequirements(cmd, msg)) return false;

    await cmd.execute(msg, cmd.regexp?.exec(text));
    return true;
}

export async function findAndExecuteCallbackCommand(commands: CallbackCommand[], query: CallbackQuery): Promise<boolean> {
    const data = query.data || "";

    const cmd = searchCallbackCommand(commands, data);
    if (!cmd) return false;

    if (!await checkRequirements(cmd, undefined, query)) return false;

    await cmd.execute(query);
    await cmd.answerCallbackQuery(query);
    await cmd.afterExecute(query);
    return true;
}

export async function oldEditMessageText(chatId: number, messageId: number, messageText: string, parseMode?: ParseMode, replyMarkup?: InlineKeyboardMarkup): Promise<boolean | Message> {
    return editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: messageText,
        parse_mode: parseMode,
        reply_markup: replyMarkup,
        link_preview_options: {is_disabled: true}
    });
}

export async function editMessageText(options: EditOptions, retries = 1) {
    if (options.text.trim().length === 0) return Promise.resolve(false);

    try {
        const chatId = "message" in options ? options.message.chat.id : options.chat_id;
        const chatType = "message" in options ? options.message.chat.type : undefined;
        const messageId = "message" in options ? options.message.message_id : options.message_id;
        const message = await enqueueTelegramApiCall(
            () => bot.editMessageText({
                chat_id: chatId,
                message_id: messageId,
                text: options.text,
                parse_mode: options.parse_mode,
                reply_markup: options.reply_markup,
                link_preview_options: options.link_preview_options,
            }),
            {
                method: "editMessageText",
                chatId,
                chatType,
            }
        );
        return Promise.resolve(message);
    } catch (error) {
        logError(error instanceof Error ? error : String(error));

        if (isMarkupFailed(error as Error | TelegramError)) {
            return Promise.resolve(true);
        } else if (isTooManyRequests(error as Error | TelegramError) && retries > 0) {
            const retryAfter = Number((error instanceof Error ? error.message : String(error)).split("retry after ")[1]) || 30;
            await delay(retryAfter * 1000);
            return editMessageText(options, retries - 1);
        } else {
            return Promise.reject(error);
        }
    }
}

export async function oldSendMessage(message: Message, text: string, parseMode?: ParseMode): Promise<Message> {
    return sendMessage({
        message: message,
        text: text,
        parse_mode: parseMode
    });
}

export async function sendMessage(options: SendOptions): Promise<Message> {
    const chatId = "message" in options ? options.message.chat.id : options.chat_id;
    const chatType = "message" in options ? options.message.chat.type : undefined;
    const response = await enqueueTelegramApiCall(
        () => bot.sendMessage({
            chat_id: chatId,
            text: options.text,
            parse_mode: options.parse_mode,
            link_preview_options: options.link_preview_options,
            reply_markup: options.reply_markup,
        }),
        {
            method: "sendMessage",
            chatId,
            chatType,
        }
    );

    await MessageStore.put(response);

    return Promise.resolve(response);
}

export async function oldReplyToMessage(message: Message, text: string, parseMode?: ParseMode): Promise<Message> {
    return replyToMessage({
        message: message,
        text: text,
        parse_mode: parseMode
    });
}

export async function replyToMessage(options: SendOptions): Promise<Message> {
    if (!("message" in options) && !options.message_id) {
        return Promise.reject("for reply there must be message or message_id");
    }

    const chatId = "message" in options ? options.message.chat.id : options.chat_id;
    const chatType = "message" in options ? options.message.chat.type : undefined;
    const response = await enqueueTelegramApiCall(
        () => bot.sendMessage({
            chat_id: chatId,
            text: options.text,
            parse_mode: options.parse_mode,
            reply_parameters: {
                message_id: <number>("message" in options ? options.message.message_id : options.message_id)
            },
            link_preview_options: options.link_preview_options,
            reply_markup: options.reply_markup,
        }),
        {
            method: "sendMessage",
            chatId,
            chatType,
        }
    );

    await MessageStore.put(response);

    return Promise.resolve(response);
}

export async function sendErrorPlaceholder(message: Message): Promise<Message> {
    return await sendMessage({message: message, text: Environment.getErrorText()}).catch(logError) as Message;
}

export async function initSystemSpecs(): Promise<void> {
    try {
        const [os, cpu, mem] = await Promise.all([si.osInfo(), si.cpu(), si.mem()]);
        const run = getRuntimeInfo();

        const ramSize = (mem.total / 1024 / 1024 / 1024).toFixed(2);

        SystemInfo.setSystemInfo({
            os: os.distro,
            runtime: `${run.runtime} ${run.version}`,
            docker: Environment.IS_DOCKER,
            cpu: `${cpu.manufacturer} ${cpu.brand} ${cpu.physicalCores} ${Environment.systemInfoCpuCoresText} ${cpu.cores} ${Environment.systemInfoCpuThreadsText}`,
            ramGb: ramSize,
        });
        return Promise.resolve();
    } catch (e) {
        return Promise.reject(e);
    }
}

export function getRandomInt(max: number) {
    return RandomUtils.int(max);
}

export function getRangedRandomInt(from: number, to: number): number {
    return RandomUtils.rangedInt(from, to);
}

export function randomValue<T>(list: readonly T[]): T | undefined {
    return RandomUtils.value(list);
}

export function chatCommandToString(cmd: Command): string {
    const description = getLocalizedCommandDescription(cmd);

    if (!cmd.title && !description) {
        return "";
    }

    if (cmd.title && description) {
        return `${cmd.title}: ${description}`;
    }

    return `${cmd.title ? `${cmd.title}: ` : ""}${description ? `${description}` : ""}`;
}

function getLocalizedCommandDescription(cmd: Command): string | undefined {
    if (!cmd.title) return cmd.description;

    const entry = Object.entries(Environment.commandTitles)
        .find(([, title]) => title === cmd.title);

    if (!entry) return cmd.description;

    const [key] = entry as [keyof typeof Environment.commandDescriptions, string];
    return Environment.commandDescriptions[key] ?? cmd.description;
}

export function fullName(from: User | StoredUser): string {
    const isStored = "isBot" in from;

    let fullName = isStored ? from.firstName : from.first_name;

    if (isStored ? from.lastName : from.last_name) {
        fullName += " " + (isStored ? from.lastName : from.last_name);
    }

    return fullName;
}

export function isMemberAdmin(member: ChatMember): boolean {
    return member.status === "administrator" || member.status === "creator";
}

export function getUptime(): string {
    const processUptime = Math.ceil(process.uptime());

    const processDays = Math.floor(processUptime / (3600 * 24));
    const processHours = Math.floor((processUptime % (3600 * 24)) / 3600);
    const processMinutes = Math.floor((processUptime % 3600) / 60);
    const processSeconds = Math.floor(processUptime % 60);

    const processUptimeText = `${processDays > 0 ? `${processDays} d ` : ""}` +
        `${processHours > 0 ? `${processHours} h ` : ""}` +
        `${processMinutes > 0 ? `${processMinutes} m ` : ""}` +
        `${processSeconds > 0 ? `${processSeconds} s` : ""}`;

    const osUptime = Math.ceil(os.uptime());

    const osDays = Math.floor(osUptime / (3600 * 24));
    const osHours = Math.floor((osUptime % (3600 * 24)) / 3600);
    const osMinutes = Math.floor((osUptime % 3600) / 60);
    const osSeconds = Math.floor(osUptime % 60);

    const osUptimeText = `${osDays > 0 ? `${osDays} d ` : ""}` +
        `${osHours > 0 ? `${osHours} h ` : ""}` +
        `${osMinutes > 0 ? `${osMinutes} m ` : ""}` +
        `${osSeconds > 0 ? `${osSeconds} s` : ""}`;

    return Environment.getUptimeText(processUptimeText, osUptimeText);
}

export const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }

        let onAbort: (() => void) | undefined;
        let id: NodeJS.Timeout;

        const cleanup = () => {
            clearTimeout(id);
            if (onAbort) {
                signal?.removeEventListener("abort", onAbort);
                onAbort = undefined;
            }
        };

        id = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        if (signal) {
            onAbort = () => {
                cleanup();
                reject(new DOMException("Aborted", "AbortError"));
            };
            signal.addEventListener("abort", onAbort, {once: true});
        }
    });

const MARKDOWN_V2_RESERVED_RE = /([\\_*\[\]()~`>#+\-=|{}.!])/g;

// const TOKEN_PREFIX = "\uE000TG_MD_V2_";
// const TOKEN_SUFFIX = "\uE001";
// const TOKEN_RE = /\uE000TG_MD_V2_(\d+)\uE001/g;

// type TokenHit = {
//     key: string;
//     end: number;
// };

// type InlineStyleKind =
//     | "bold"
//     | "italic"
//     | "underline"
//     | "strikethrough"
//     | "spoiler";

// type InlineStyle = {
//     inputDelimiter: string;
//     outputDelimiter: string;
//     kind: InlineStyleKind;
// };

// class TelegramMarkdownV2TokenStore {
//     private readonly tokens: string[] = [];
//
//     add(value: string): string {
//         const key = `${TOKEN_PREFIX}${this.tokens.length}${TOKEN_SUFFIX}`;
//         this.tokens.push(value);
//         return key;
//     }
//
//     readAt(s: string, index: number): TokenHit | null {
//         if (!s.startsWith(TOKEN_PREFIX, index)) {
//             return null;
//         }
//
//         const idStart = index + TOKEN_PREFIX.length;
//         const idEnd = s.indexOf(TOKEN_SUFFIX, idStart);
//
//         if (idEnd === -1) {
//             return null;
//         }
//
//         const rawId = s.slice(idStart, idEnd);
//
//         if (!/^\d+$/.test(rawId)) {
//             return null;
//         }
//
//         return {
//             key: s.slice(index, idEnd + TOKEN_SUFFIX.length),
//             end: idEnd + TOKEN_SUFFIX.length,
//         };
//     }
//
//     restore(s: string): string {
//         return s.replace(TOKEN_RE, (match, rawId) => {
//             return this.tokens[Number(rawId)] ?? match;
//         });
//     }
// }

export function escapePlainMarkdownV2(s: string): string {
    return s.replace(MARKDOWN_V2_RESERVED_RE, "\\$1");
}

export function escapeCodeMarkdownV2(s: string): string {
    return s.replace(/[\\`]/g, "\\$&");
}

export function buildCancelledGenerationText(baseText: string, provider: string, limit: number = 4096): string {
    const cancellationBlock = `\`\`\`${Environment.getCancelledText(provider)}\n\`\`\``;
    const separator = "\n\n";
    const trimmedBase = baseText.trim();

    // Return regular Markdown, not already escaped MarkdownV2.
    // Final escaping must happen exactly once right before sending to Telegram.
    if (!trimmedBase.length) {
        return cancellationBlock;
    }

    const fullText = `${trimmedBase}${separator}${cancellationBlock}`;
    if (fullText.length <= limit) {
        return fullText;
    }

    const maxBaseLength = Math.max(0, limit - cancellationBlock.length - separator.length - 3);
    const truncatedBase = trimmedBase.slice(0, maxBaseLength).trimEnd();

    return `${truncatedBase}...${separator}${cancellationBlock}`;
}


export function escapeLinkUrlMarkdownV2(s: string): string {
    return s.replace(/[\\)]/g, "\\$&");
}

// function normalizeLineEndings(s: string): string {
//     return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
// }

// function stripOneOuterNewline(s: string): string {
//     return s.replace(/^\n/, "").replace(/\n$/, "");
// }

// function normalizeCodeLanguage(lang: string | undefined): string {
//     const trimmed = lang?.trim() ?? "";
//     return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : "";
// }

// function renderCodeBlockMarkdownV2(code: string, lang?: string): string {
//     const safeLang = normalizeCodeLanguage(lang);
//     const safeCode = escapeCodeMarkdownV2(stripOneOuterNewline(code));
//     return "```" + safeLang + "\n" + safeCode + "\n```";
// }

// function renderInlineCodeMarkdownV2(code: string): string {
//     return "`" + escapeCodeMarkdownV2(code) + "`";
// }

// function protectFencedCodeBlocks(
//     s: string,
//     store: TelegramMarkdownV2TokenStore,
// ): string {
//     return s.replace(/```([a-zA-Z0-9_-]*)[^\S\n]*\n?([\s\S]*?)```/g, (_full, lang: string, code: string) => {
//         return store.add(renderCodeBlockMarkdownV2(code, lang));
//     });
// }

// function findClosingSquareBracket(s: string, from: number): number {
//     for (let i = from; i < s.length; i++) {
//         if (s[i] === "\\") {
//             i++;
//             continue;
//         }
//
//         if (s[i] === "\n") {
//             return -1;
//         }
//
//         if (s[i] === "]") {
//             return i;
//         }
//     }
//
//     return -1;
// }

// function findClosingParen(s: string, from: number): number {
//     let depth = 1;
//
//     for (let i = from; i < s.length; i++) {
//         const ch = s[i];
//
//         if (ch === "\\") {
//             i++;
//             continue;
//         }
//
//         if (ch === "\n") {
//             return -1;
//         }
//
//         if (ch === "(") {
//             depth++;
//             continue;
//         }
//
//         if (ch === ")") {
//             depth--;
//
//             if (depth === 0) {
//                 return i;
//             }
//         }
//     }
//
//     return -1;
// }

// function parseBracketParen(
//     s: string,
//     openBracketIndex: number,
// ): { label: string; url: string; end: number } | null {
//     if (s[openBracketIndex] !== "[") {
//         return null;
//     }
//
//     const closeBracket = findClosingSquareBracket(s, openBracketIndex + 1);
//
//     if (closeBracket === -1 || s[closeBracket + 1] !== "(") {
//         return null;
//     }
//
//     const closeParen = findClosingParen(s, closeBracket + 2);
//
//     if (closeParen === -1) {
//         return null;
//     }
//
//     return {
//         label: s.slice(openBracketIndex + 1, closeBracket),
//         url: s.slice(closeBracket + 2, closeParen),
//         end: closeParen + 1,
//     };
// }

// function unescapeMarkdownLabel(s: string): string {
//     return s.replace(/\\([\\\[\]])/g, "$1");
// }

// function unescapeMarkdownUrl(s: string): string {
//     return s.replace(/\\([\\)])/g, "$1");
// }

// function parseQueryParam(query: string, key: string): string | undefined {
//     for (const part of query.split("&")) {
//         const eq = part.indexOf("=");
//
//         if (eq === -1) {
//             if (part === key) {
//                 return "";
//             }
//
//             continue;
//         }
//
//         const paramKey = part.slice(0, eq);
//         const paramValue = part.slice(eq + 1);
//
//         if (paramKey === key) {
//             return paramValue;
//         }
//     }
//
//     return undefined;
// }

// export function isValidTelegramDateTimeFormat(format: string): boolean {
//     return /^(?:r|w?[dD]?[tT]?)$/.test(format);
// }

// function isValidTelegramTimeUrl(url: string): boolean {
//     const match = /^tg:\/\/time\?(.+)$/i.exec(url.trim());
//
//     if (!match) {
//         return false;
//     }
//
//     const query = match[1];
//     const unix = parseQueryParam(query, "unix");
//     const format = parseQueryParam(query, "format");
//
//     if (!unix || !/^-?\d+$/.test(unix)) {
//         return false;
//     }
//
//     return format === undefined || isValidTelegramDateTimeFormat(format);
// }

// function isValidTelegramEmojiUrl(url: string): boolean {
//     return /^tg:\/\/emoji\?id=\d+$/i.test(url.trim());
// }

// function isTelegramSpecialEntityUrl(url: string): boolean {
//     return isValidTelegramEmojiUrl(url) || isValidTelegramTimeUrl(url);
// }

// function renderTelegramSpecialEntityMarkdownV2(label: string, url: string): string {
//     return `![${escapePlainMarkdownV2(label)}](${escapeLinkUrlMarkdownV2(url)})`;
// }

// function renderInlineLinkMarkdownV2(label: string, url: string): string {
//     const safeLabel = label.trim().length > 0 ? label : url;
//     return `[${escapePlainMarkdownV2(safeLabel)}](${escapeLinkUrlMarkdownV2(url)})`;
// }

// function findInlineCodeEnd(s: string, from: number): number {
//     for (let i = from; i < s.length; i++) {
//         if (s[i] === "\n") {
//             return -1;
//         }
//
//         if (s[i] === "`") {
//             return i;
//         }
//     }
//
//     return -1;
// }

// function protectInlineEntities(
//     s: string,
//     store: TelegramMarkdownV2TokenStore,
// ): string {
//     let result = "";
//     let i = 0;
//
//     while (i < s.length) {
//         const token = store.readAt(s, i);
//
//         if (token) {
//             result += token.key;
//             i = token.end;
//             continue;
//         }
//
//         if (s.startsWith("![", i)) {
//             const parsed = parseBracketParen(s, i + 1);
//
//             if (parsed) {
//                 const label = unescapeMarkdownLabel(parsed.label);
//                 const url = unescapeMarkdownUrl(parsed.url.trim());
//
//                 if (isTelegramSpecialEntityUrl(url)) {
//                     result += store.add(renderTelegramSpecialEntityMarkdownV2(label, url));
//                 } else {
//                     result += label.trim().length > 0 ? `${label}: ${url}` : url;
//                 }
//
//                 i = parsed.end;
//                 continue;
//             }
//         }
//
//         if (s[i] === "[") {
//             const parsed = parseBracketParen(s, i);
//
//             if (parsed) {
//                 const label = unescapeMarkdownLabel(parsed.label);
//                 const url = unescapeMarkdownUrl(parsed.url.trim());
//
//                 if (url.length > 0) {
//                     result += store.add(renderInlineLinkMarkdownV2(label, url));
//                     i = parsed.end;
//                     continue;
//                 }
//             }
//         }
//
//         if (s[i] === "`") {
//             const end = findInlineCodeEnd(s, i + 1);
//
//             if (end !== -1) {
//                 result += store.add(renderInlineCodeMarkdownV2(s.slice(i + 1, end)));
//                 i = end + 1;
//                 continue;
//             }
//         }
//
//         result += s[i];
//         i++;
//     }
//
//     return result;
// }

// function isMarkdownTableSeparator(line: string): boolean {
//     return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
// }

// function looksLikeMarkdownTableRow(line: string): boolean {
//     const trimmed = line.trim();
//
//     if (!trimmed.includes("|")) {
//         return false;
//     }
//
//     return !(trimmed.startsWith("||") && trimmed.endsWith("||"));
// }

// function splitMarkdownTableRow(line: string): string[] {
//     const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
//     const cells: string[] = [];
//     let current = "";
//
//     for (let i = 0; i < normalized.length; i++) {
//         const ch = normalized[i];
//
//         if (ch === "\\") {
//             current += ch;
//
//             if (i + 1 < normalized.length) {
//                 current += normalized[i + 1];
//                 i++;
//             }
//
//             continue;
//         }
//
//         if (ch === "|") {
//             cells.push(current.trim());
//             current = "";
//             continue;
//         }
//
//         current += ch;
//     }
//
//     cells.push(current.trim());
//     return cells.filter(Boolean);
// }

// function normalizeMarkdownTables(s: string): string {
//     const lines = s.split("\n");
//     const result: string[] = [];
//     let i = 0;
//
//     while (i < lines.length) {
//         const current = lines[i];
//         const next = lines[i + 1];
//
//         if (
//             next !== undefined &&
//             looksLikeMarkdownTableRow(current) &&
//             isMarkdownTableSeparator(next)
//         ) {
//             const tableRows = [current];
//             i += 2;
//
//             while (
//                 i < lines.length &&
//                 looksLikeMarkdownTableRow(lines[i]) &&
//                 !isMarkdownTableSeparator(lines[i])
//                 ) {
//                 tableRows.push(lines[i]);
//                 i++;
//             }
//
//             for (const row of tableRows) {
//                 const cells = splitMarkdownTableRow(row);
//
//                 if (cells.length > 0) {
//                     result.push(cells.join(" — "));
//                 }
//             }
//
//             continue;
//         }
//
//         result.push(current);
//         i++;
//     }
//
//     return result.join("\n");
// }

// function normalizeUnsupportedMarkdownLine(line: string): string {
//     const headingMatch = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
//
//     if (headingMatch) {
//         return `*${headingMatch[1].trim()}*`;
//     }
//
//     if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
//         return "— — —";
//     }
//
//     line = line.replace(/^(\s*)[-*+]\s+\[\s]\s+(?=\S)/i, "$1☐ ");
//     line = line.replace(/^(\s*)[-*+]\s+\[[xX]]\s+(?=\S)/, "$1☑ ");
//     line = line.replace(/^(\s*)[-*+]\s+(?=\S)/, "$1• ");
//     line = line.replace(/^(\s*)(\d+)[.)]\s+(?=\S)/, "$1$2) ");
//
//     return line;
// }

// function normalizeUnsupportedMarkdown(s: string): string {
//     return normalizeMarkdownTables(s)
//         .split("\n")
//         .map(normalizeUnsupportedMarkdownLine)
//         .join("\n");
// }

// function isWhitespace(ch: string | undefined): boolean {
//     return ch !== undefined && /\s/.test(ch);
// }

// function isWordChar(ch: string | undefined): boolean {
//     return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
// }

// function canOpenDelimiter(
//     s: string,
//     index: number,
//     delimiter: string,
//     kind: InlineStyleKind,
// ): boolean {
//     const before = s[index - 1];
//     const after = s[index + delimiter.length];
//
//     if (after === undefined || isWhitespace(after)) {
//         return false;
//     }
//
//     return !((kind === "bold" || kind === "italic" || kind === "strikethrough") &&
//         isWordChar(before) &&
//         isWordChar(after));
// }

// function canCloseDelimiter(
//     s: string,
//     index: number,
//     delimiter: string,
//     kind: InlineStyleKind,
// ): boolean {
//     const before = s[index - 1];
//     const after = s[index + delimiter.length];
//
//     if (before === undefined || isWhitespace(before)) {
//         return false;
//     }
//
//     return !((kind === "bold" || kind === "italic" || kind === "strikethrough") &&
//         isWordChar(before) &&
//         isWordChar(after));
// }

// function findClosingDelimiter(
//     s: string,
//     delimiter: string,
//     from: number,
//     kind: InlineStyleKind,
//     store: TelegramMarkdownV2TokenStore,
// ): number {
//     for (let i = from; i < s.length; i++) {
//         const token = store.readAt(s, i);
//
//         if (token) {
//             i = token.end - 1;
//             continue;
//         }
//
//         if (s[i] === "\\") {
//             i++;
//             continue;
//         }
//
//         if (s.startsWith(delimiter, i) && canCloseDelimiter(s, i, delimiter, kind)) {
//             return i;
//         }
//     }
//
//     return -1;
// }

// function formatInlineMarkdownV2(
//     s: string,
//     store: TelegramMarkdownV2TokenStore,
// ): string {
//     const styles: InlineStyle[] = [
//         {inputDelimiter: "||", outputDelimiter: "||", kind: "spoiler"},
//         {inputDelimiter: "__", outputDelimiter: "__", kind: "underline"},
//         {inputDelimiter: "**", outputDelimiter: "*", kind: "bold"},
//         {inputDelimiter: "~~", outputDelimiter: "~", kind: "strikethrough"},
//         {inputDelimiter: "*", outputDelimiter: "*", kind: "bold"},
//         {inputDelimiter: "_", outputDelimiter: "_", kind: "italic"},
//         {inputDelimiter: "~", outputDelimiter: "~", kind: "strikethrough"},
//     ];
//
//     let result = "";
//     let i = 0;
//
//     while (i < s.length) {
//         const token = store.readAt(s, i);
//
//         if (token) {
//             result += token.key;
//             i = token.end;
//             continue;
//         }
//
//         if (s[i] === "\\" && i + 1 < s.length) {
//             result += escapePlainMarkdownV2(s[i + 1]);
//             i += 2;
//             continue;
//         }
//
//         let handled = false;
//
//         for (const style of styles) {
//             const delimiter = style.inputDelimiter;
//
//             if (!s.startsWith(delimiter, i)) {
//                 continue;
//             }
//
//             if (!canOpenDelimiter(s, i, delimiter, style.kind)) {
//                 continue;
//             }
//
//             const end = findClosingDelimiter(
//                 s,
//                 delimiter,
//                 i + delimiter.length,
//                 style.kind,
//                 store,
//             );
//
//             if (end === -1) {
//                 continue;
//             }
//
//             const content = s.slice(i + delimiter.length, end);
//
//             if (content.length === 0) {
//                 continue;
//             }
//
//             result +=
//                 style.outputDelimiter +
//                 formatInlineMarkdownV2(content, store) +
//                 style.outputDelimiter;
//
//             i = end + delimiter.length;
//             handled = true;
//             break;
//         }
//
//         if (handled) {
//             continue;
//         }
//
//         result += escapePlainMarkdownV2(s[i]);
//         i++;
//     }
//
//     return result;
// }

// function renderMarkdownV2Line(
//     line: string,
//     store: TelegramMarkdownV2TokenStore,
// ): string {
//     if (line.startsWith("**>")) {
//         let content = line.slice(3).replace(/^\s?/, "");
//         const isExpandableEnd = content.endsWith("||");
//
//         if (isExpandableEnd) {
//             content = content.slice(0, -2);
//         }
//
//         return `**>${formatInlineMarkdownV2(content, store)}${isExpandableEnd ? "||" : ""}`;
//     }
//
//     if (line.startsWith(">")) {
//         const content = line.slice(1).replace(/^\s?/, "");
//
//         if (!content.trim()) {
//             return ">";
//         }
//
//         return ">" + formatInlineMarkdownV2(content, store);
//     }
//
//     return formatInlineMarkdownV2(line, store);
// }

// function renderMarkdownV2(
//     s: string,
//     store: TelegramMarkdownV2TokenStore,
// ): string {
//     return s
//         .split("\n")
//         .map(line => renderMarkdownV2Line(line, store))
//         .join("\n");
// }

// export function escapeMarkdownV2Text(input: string): string {
//     const store = new TelegramMarkdownV2TokenStore();
//
//     let s = normalizeLineEndings(input);
//
//     s = protectFencedCodeBlocks(s, store);
//     s = protectInlineEntities(s, store);
//     s = normalizeUnsupportedMarkdown(s);
//     s = renderMarkdownV2(s, store);
//     s = s.replace(/\n{3,}/g, "\n\n").trim();
//     s = store.restore(s);
//
//     return s.trim();
// }

export async function getFileUrl(fileId: string): Promise<string> {
    const file = await bot.getFile({file_id: fileId});
    return `https://api.telegram.org/file/bot${bot.botToken}/${file.file_path}`;
}

export async function getChatAvatar(chatId: number): Promise<Buffer | null> {
    try {
        const chat = await bot.getChat({chat_id: chatId});
        const photo = chat?.photo?.big_file_id || chat?.photo?.small_file_id;
        if (!photo) return null;

        const url = await getFileUrl(photo);
        const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

export async function getUserAvatar(userId: number): Promise<Buffer | null> {
    const photos = await bot.getUserProfilePhotos({user_id: userId, limit: 1});
    const last: PhotoSize | undefined = photos.photos?.[0]?.[photos.photos[0].length - 1];
    if (!last) return null;

    const url = await getFileUrl(last.file_id);
    const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});
    return Buffer.from(res.data);
}

export function extractMessageQuote(msg: Message | StoredMessage | null | undefined): string | undefined | null {
    if (!msg) return null;

    return isStoredMessage(msg) ? msg.quoteText : msg.quote?.text;
}

export function extractTextMessage(msg: Message | StoredMessage | string): string | null {
    if (!msg) return null;
    if (typeof msg === "string") return msg;

    const text = (isStoredMessage(msg) ? msg.text : msg.text || msg.caption || "")?.trim();
    if (!text || !text?.length) return null;
    return text;
}

export function escapeHtml(input: string): string {
    return HtmlUtils.escape(input);
}

export function cutPrefixes(msg: Message | StoredMessage | string | null): string | null {
    if (!msg) return null;
    const chatCommands = commands.filter(c => c instanceof ChatCommand);

    const prefixes = Environment.BOT_PREFIX ? [Environment.BOT_PREFIX] : [];
    const pushPrefix = (c: string) => {
        prefixes.push(`/${c}@${botUser.username}`);
        prefixes.push(`/${c}`);
    };

    chatCommands.forEach((cmd) => {
        const command = cmd.command;
        if (command) {
            if (Array.isArray(command)) {
                command.forEach(pushPrefix);
            } else {
                pushPrefix(command);
            }
        }
    });

    const text = extractTextMessage(msg);
    if (!text || !text.length) return "";

    let newText = text;

    for (const prefix of prefixes) {
        if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
            newText = newText.substring(prefix.length).trim();
            break;
        }
    }

    return newText;
}

export function isStoredMessage(msg: Message | StoredMessage | null): msg is StoredMessage {
    return !!msg && "id" in msg;
}

function mimeTypeFromImagePath(filePath: string, fallback = "image/jpeg"): string {
    switch (path.extname(filePath).toLowerCase()) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        default:
            return fallback;
    }
}

function mimeTypeFromImageAttachment(attachment: StoredAttachment): string {
    const mimeType = attachment.mimeType?.toLowerCase();
    if (mimeType?.startsWith("image/")) return mimeType;
    return mimeTypeFromImagePath(attachment.cachePath);
}

function mimeTypeFromAudioPath(filePath: string, fallback = "audio/wav"): string {
    switch (path.extname(filePath).toLowerCase()) {
        case ".mp3":
            return "audio/mpeg";
        case ".m4a":
            return "audio/m4a";
        case ".ogg":
        case ".oga":
            return "audio/ogg";
        case ".opus":
            return "audio/opus";
        case ".flac":
            return "audio/flac";
        case ".aac":
            return "audio/aac";
        case ".wav":
            return "audio/wav";
        default:
            return fallback;
    }
}

function mimeTypeFromAudioDownload(download: AiDownloadedFile): string {
    const mimeType = download.mimeType?.toLowerCase();
    if (mimeType?.startsWith("audio/")) return mimeType;
    return mimeTypeFromAudioPath(download.path);
}

export async function loadImagesIfExists(msg: Message | StoredMessage): Promise<string[] | null | undefined> {
    if (isStoredMessage(msg)) {
        return msg.attachments
            ?.filter(attachment => attachment.kind === "image")
            .map(attachment => attachment.fileUniqueId || path.basename(attachment.cachePath, path.extname(attachment.cachePath)));
    }

    if (!msg.photo?.length) return;

    const imageFilePaths: string[] = [];

    const maxSize = getPhotoMaxSize(msg.photo);
    if (!maxSize) return [];

    const exists = fs.existsSync(photoPathByUniqueId(maxSize.file_unique_id));
    if (exists) {
        return [maxSize.file_unique_id];
    }

    const photoMaxSize = await mapPhotoSizeToMax(maxSize);
    if (photoMaxSize) {
        let imageFilePath: string | null = photoPathByUniqueId(maxSize.file_unique_id);
        if (!fs.existsSync(imageFilePath)) {
            await fileWriteLocks.runExclusive(imageFilePath, async () => {
                if (fs.existsSync(imageFilePath!)) return;

                const res = await axios.get<ArrayBuffer>(photoMaxSize.url, {responseType: "arraybuffer"});
                const src = Buffer.from(res.data);

                try {
                    const tempPath = `${imageFilePath}.${process.pid}.${Date.now()}.tmp`;
                    fs.writeFileSync(tempPath, src);
                    fs.renameSync(tempPath, imageFilePath!);
                } catch (e) {
                    logError(e instanceof Error ? e : String(e));
                    imageFilePath = null;
                }
            });
        }

        if (imageFilePath) {
            imageFilePaths.push(imageFilePath);
        }
    }

    return imageFilePaths;
}

export async function loadImagesFromFileIds(sizes: PhotoSize[]): Promise<string[] | null> {
    if (!sizes?.length) return null;

    const existing =
        sizes.filter(s => fs.existsSync(photoPathByUniqueId(s.file_unique_id)))
            .map(s => s.file_unique_id);

    const promises = sizes.filter(s => !fs.existsSync(photoPathByUniqueId(s.file_unique_id)))
        .map(s => mapPhotoSizeToMax(s));

    const maxSizes = (await Promise.all(promises)).filter(e => !!e);

    const imagePromises = maxSizes.map((size) => {
        return axios.get<ArrayBuffer>(size.url, {responseType: "arraybuffer"});
    });

    const responses = await Promise.all(imagePromises);
    const paths = await Promise.all(responses.map((res, index) => {
        try {
            const uniqueFileId = maxSizes[index].unique_file_id;
            const imageFilePath = path.join(photoDir, uniqueFileId + ".jpg");
            const src = Buffer.from(res.data);
            return fileWriteLocks.runExclusive(imageFilePath, async () => {
                if (!fs.existsSync(imageFilePath)) {
                    const tempPath = `${imageFilePath}.${process.pid}.${Date.now()}.tmp`;
                    fs.writeFileSync(tempPath, src);
                    fs.renameSync(tempPath, imageFilePath);
                }
                return uniqueFileId;
            });
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
            return null;
        }
    }));
    const finalPaths = existing.concat(...paths.filter(p => !!p).map(p => <string>p));
    return finalPaths;
}

export type ReplyChainOptions = {
    triggerMsg: Message | StoredMessage | null | undefined,
    limit?: number,
    includeTrigger?: boolean;
    cutPrefix?: boolean,
    downloads?: AiDownloadedFile[]
}

export async function collectReplyChainText(options: ReplyChainOptions): Promise<MessagePart[]> {
    const triggerMsg = options.triggerMsg;
    const limit = options.limit ?? 40;
    const includeTrigger = options.includeTrigger ?? true;
    const cutPrefix = options.cutPrefix ?? true;
    const downloads = options.downloads ?? [];

    if (!triggerMsg) return [];

    const parts: MessagePart[] = [];

    function resolveStoredImagePath(imageName: string, attachments: StoredAttachment[]): string | undefined {
        const directPath = photoPathByUniqueId(imageName);
        if (fs.existsSync(directPath)) return directPath;

        const attachment = attachments.find(item => {
            if (item.kind !== "image") return false;
            if (item.fileUniqueId && item.fileUniqueId === imageName) return true;
            return path.basename(item.cachePath, path.extname(item.cachePath)) === imageName;
        });

        if (attachment && fs.existsSync(attachment.cachePath)) {
            return attachment.cachePath;
        }

        return undefined;
    }

    const pushPart = async (msg: Message | StoredMessage | undefined | null, textRequired: boolean = false, includeDownloads: boolean = false) => {
        if (msg) {
            const quoteText = extractMessageQuote(msg);
            const rawText = extractTextMessage(msg);
            const cleanText = cutPrefix ? cutPrefixes(rawText) : rawText;
            const imageNames = await loadImagesIfExists(msg);
            const messageDownloads = includeDownloads ? downloads : [];
            const storedAttachments = isStoredMessage(msg)
                ? filterUserInputStoredAttachments(msg.attachments ?? []).filter(attachment => fs.existsSync(attachment.cachePath))
                : [];
            const storedImageAttachments = storedAttachments.filter(attachment => attachment.kind === "image");

            if (!cleanText && !quoteText && textRequired) return;
            if (!cleanText && !quoteText && !imageNames?.length && !storedAttachments.length && !messageDownloads.length) return;

            const fromId = isStoredMessage(msg) ? msg.fromId : msg.from?.id;
            const user = await UserStore.get(isStoredMessage(msg) ? msg.fromId : msg.from?.id ?? -1);

            const firstName = isStoredMessage(msg) ? user?.firstName : msg.from?.first_name;

            const photoImageParts: MessageImagePart[] = imageNames ? imageNames.flatMap(n => {
                const filePath = isStoredMessage(msg)
                    ? resolveStoredImagePath(n, storedImageAttachments)
                    : (fs.existsSync(photoPathByUniqueId(n)) ? photoPathByUniqueId(n) : undefined);

                if (!filePath) {
                    messageLogger.warn("reply_chain.image_missing", {imageName: n, chatId: isStoredMessage(msg) ? msg.chatId : msg.chat?.id, messageId: isStoredMessage(msg) ? msg.id : msg.message_id});
                    return [];
                }

                return [{
                    data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
                    mimeType: mimeTypeFromImagePath(filePath),
                }];
            }) : [];
            const imageNameSet = new Set(imageNames ?? []);
            const cachedImageAttachments = storedImageAttachments.filter(attachment => {
                if (attachment.fileUniqueId && imageNameSet.has(attachment.fileUniqueId)) return false;
                return !imageNameSet.has(path.basename(attachment.cachePath, path.extname(attachment.cachePath)));
            });
            const cachedImageParts: MessageImagePart[] = cachedImageAttachments.map(attachment => {
                return {
                    data: Buffer.from(fs.readFileSync(attachment.cachePath)).toString("base64"),
                    mimeType: mimeTypeFromImageAttachment(attachment),
                };
            });
            const imageParts = [...photoImageParts, ...cachedImageParts];

            const storedDocumentAttachments = storedAttachments.filter(attachment => attachment.kind === "document");
            const storedVideoAttachments = storedAttachments.filter(attachment => attachment.kind === "video");
            const storedVideoNoteAttachments = storedAttachments.filter(attachment => attachment.kind === "video-note");
            const storedAudioAttachments = storedAttachments.filter(attachment => attachment.kind === "audio");

            const audios: string[] = [];
            const audioParts: MessageAudioPart[] = [];
            const documents: string[] = [];
            const documentNames: string[] = [];
            const videos: string[] = [];
            const videoNames: string[] = [];
            const videoNotes: string[] = [];
            const videoNoteNames: string[] = [];

            if (messageDownloads.length) {
                messageDownloads
                    .filter(d => d.kind === "audio")
                    .forEach(a => {
                        const data = a.buffer.toString("base64");
                        audios.push(data);
                        audioParts.push({data, mimeType: mimeTypeFromAudioDownload(a)});
                    });

                messageDownloads
                    .filter(d => d.kind === "document")
                    .forEach(d => {
                        documents.push(d.buffer.toString("base64"));
                        documentNames.push(d.fileName);
                    });

                messageDownloads
                    .filter(d => d.kind === "video")
                    .forEach(v => {
                        videos.push(v.buffer.toString("base64"));
                        videoNames.push(v.fileName);
                    });

                messageDownloads
                    .filter(d => d.kind === "video-note")
                    .forEach(v => {
                        const data = v.buffer.toString("base64");
                        videoNotes.push(data);
                        videoNoteNames.push(v.fileName);
                        audioParts.push({data, mimeType: mimeTypeFromAudioDownload(v)});
                    });
            }

            storedAudioAttachments.forEach(attachment => {
                const data = Buffer.from(fs.readFileSync(attachment.cachePath)).toString("base64");
                audios.push(data);
                audioParts.push({data, mimeType: attachment.mimeType || "audio/ogg"});
            });

            storedDocumentAttachments.forEach(attachment => {
                documents.push(Buffer.from(fs.readFileSync(attachment.cachePath)).toString("base64"));
                documentNames.push(attachment.fileName);
            });

            storedVideoAttachments.forEach(attachment => {
                videos.push(Buffer.from(fs.readFileSync(attachment.cachePath)).toString("base64"));
                videoNames.push(attachment.fileName);
            });

            storedVideoNoteAttachments.forEach(attachment => {
                const data = Buffer.from(fs.readFileSync(attachment.cachePath)).toString("base64");
                videoNotes.push(data);
                videoNoteNames.push(attachment.fileName);
                audioParts.push({data, mimeType: attachment.mimeType || "video/mp4"});
            });

            const content = [
                quoteText ? `[citation]:\n${quoteText}\n\n[message]:\n` : "",
                cleanText ?? ""
            ].join("\n").trim();

            parts.push({
                bot: fromId === botUser.id,
                content: content,
                name: firstName,
                langCode: user?.langCode,
                userName: user?.userName,
                deletedByBotAt: isStoredMessage(msg) ? msg.deletedByBotAt : undefined,
                images: imageParts.map(image => image.data),
                imageParts: imageParts.length ? imageParts : undefined,
                audios: audios.length ? audios : undefined,
                audioParts: audioParts.length ? audioParts : undefined,
                documents: documents.length ? documents : undefined,
                documentNames: documentNames.length ? documentNames : undefined,
                videos: videos.length ? videos : undefined,
                videoNames: videoNames.length ? videoNames : undefined,
                videoNotes: videoNotes.length ? videoNotes : undefined,
                videoNoteNames: videoNoteNames.length ? videoNoteNames : undefined,
            });
        }
    };

    const chatId = isStoredMessage(triggerMsg) ? triggerMsg.chatId as number : triggerMsg.chat.id;

    if (includeTrigger) {
        await pushPart(triggerMsg, false, true);
    }

    const first = isStoredMessage(triggerMsg) ?
        (await MessageStore.get(chatId, triggerMsg.replyToMessageId)) :
        triggerMsg.reply_to_message;
    if (!first) {
        return parts;
    }
    await pushPart(first, false);

    let curId = isStoredMessage(first) ? first.id : first.message_id;

    while (parts.length < limit) {
        const cur = await messageDao.getById({chatId: chatId, id: curId});
        const parentId = cur?.replyToMessageId ?? null;
        if (!parentId) break;

        const parent = await messageDao.getById({chatId: chatId, id: parentId});
        await pushPart(parent, false);
        curId = parentId;
    }

    return parts;
}

export function extractMessagePayload(msg: Message, matchText?: string): string | null {
    const payload = (matchText ?? "").trim();
    if (payload.length) return payload;

    const quote = msg.quote;
    if (quote?.text) return quote.text;

    const r = msg.reply_to_message;
    if (!r) return null;

    const t =
        (r.text ?? "") ||
        (r.caption ?? "") ||
        (r.document?.file_name ?? "") ||
        "";

    return t.trim().length ? t.trim() : null;
}

export function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

export async function waveDistortSharp(
    input: Buffer,
    amp = 14,
    wavelength = 72,
    maxSide = 1024
): Promise<Buffer> {
    return imageProcessingSemaphore.runExclusive(async () => {
        amp = clamp(amp, 2, 60);
        wavelength = clamp(wavelength, 16, 300);

        const phase1 = Math.random() * Math.PI * 2;
        const phase2 = Math.random() * Math.PI * 2;
        const amp2 = Math.max(6, Math.floor(amp * 0.6));
        const wavelength2 = Math.max(32, Math.floor(wavelength * 1.4));

        const {data, info} = await sharp(input)
            .resize({width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true})
            .ensureAlpha()
            .raw()
            .toBuffer({resolveWithObject: true});

        const width = info.width!;
        const height = info.height!;
        const channels = info.channels!; // usually 4 (RGBA)

        const out = Buffer.alloc(data.length);

        for (let y = 0; y < height; y++) {
            const dx = amp * Math.sin((2 * Math.PI * y) / wavelength + phase1);

            for (let x = 0; x < width; x++) {
                const dy = amp2 * Math.sin((2 * Math.PI * x) / wavelength2 + phase2);

                const sx = Math.round(x + dx);
                const sy = Math.round(y + dy);

                const di = (y * width + x) * channels;

                if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
                    // transparent pixel
                    out[di] = 0;
                    out[di + 1] = 0;
                    out[di + 2] = 0;
                    out[di + 3] = 0;
                    continue;
                }

                const si = (sy * width + sx) * channels;
                data.copy(out, di, si, si + channels);
            }
        }

        return await sharp(out, {raw: {width, height, channels}})
            .png()
            .toBuffer();
    });
}

export async function downloadTelegramFile(filePath?: string | null): Promise<Buffer | null> {
    if (!filePath) return null;
    const url = `https://api.telegram.org/file/bot${Environment.BOT_TOKEN}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
}

export function extractImageFileId(reply: Message): string | null {
    // photo (compressed)
    if (reply.photo?.length) {
        return reply.photo[reply.photo.length - 1]!.file_id; // largest
    }
    // document (usually original)
    if (reply.document?.mime_type?.startsWith("image/")) {
        return reply.document.file_id;
    }

    if (reply.sticker?.file_id) {
        return reply.sticker.file_id;
    }
    return null;
}

export async function makeDarkGradientBgFancy(
    width: number,
    height: number,
    seed?: string
): Promise<Buffer> {
    const rnd = seed ? seededRand(seed) : Math.random;

    const hue1 = Math.floor(rnd() * 360);
    const hue2 = (hue1 + 25 + Math.floor(rnd() * 55)) % 360;
    const hue3 = (hue2 + 25 + Math.floor(rnd() * 55)) % 360;

    const c1 = hslToHex(hue1, 35 + rndInt(rnd, 0, 14), 12 + rndInt(rnd, 0, 6));
    const c2 = hslToHex(hue2, 35 + rndInt(rnd, 0, 14), 9 + rndInt(rnd, 0, 5));
    const c3 = hslToHex(hue3, 30 + rndInt(rnd, 0, 14), 8 + rndInt(rnd, 0, 5));

    // random gradient angle
    const x1 = rnd(), y1 = rnd();
    const x2 = 1 - x1, y2 = 1 - y1;

    // soft glow
    const glowHue = (hue1 + rndInt(rnd, -25, 25) + 360) % 360;
    const glowColor = hslToHex(glowHue, 60, 60);
    const glowCx = 0.35 + rnd() * 0.30;
    const glowCy = 0.30 + rnd() * 0.35;
    const glowR = 0.55 + rnd() * 0.25;
    const glowOpacity = 0.14 + rnd() * 0.10;

    // vignette
    const vignetteStrength = 0.55 + rnd() * 0.15;

    // grain
    const grainSeed = Math.floor(rnd() * 10_000);
    const grainAlpha = 0.10 + rnd() * 0.06; // 0.10..0.16
    const grainFreq = 0.75 + rnd() * 0.35;  // 0.75..1.10

    const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="55%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c3}"/>
    </linearGradient>

    <radialGradient id="glow" cx="${glowCx}" cy="${glowCy}" r="${glowR}">
      <stop offset="0%" stop-color="${glowColor}" stop-opacity="${glowOpacity}"/>
      <stop offset="55%" stop-color="${glowColor}" stop-opacity="${glowOpacity * 0.45}"/>
      <stop offset="100%" stop-color="${glowColor}" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.85">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="55%" stop-color="#000" stop-opacity="${vignetteStrength * 0.25}"/>
      <stop offset="100%" stop-color="#000" stop-opacity="${vignetteStrength}"/>
    </radialGradient>

    <!-- grain: black noise with low alpha -->
    <filter id="grain" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise"
        baseFrequency="${grainFreq}"
        numOctaves="2"
        seed="${grainSeed}"
        result="t"/>
      <!-- RGB -> Alpha, RGB = 0 -->
      <feColorMatrix in="t" type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0.33 0.33 0.33 0 0"
        result="a"/>
      <!-- scale alpha (grain intensity) -->
      <feComponentTransfer in="a">
        <feFuncA type="linear" slope="${grainAlpha}"/>
      </feComponentTransfer>
    </filter>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <rect width="100%" height="100%" fill="url(#vig)"/>
  <rect width="100%" height="100%" filter="url(#grain)"/>
</svg>`);

    return sharp(svg)
        .resize(width, height)
        .blur(0.6) // slightly smooth the gradient/glow (grain gets softer too)
        .png()
        .toBuffer();
}

export function rndInt(rnd: () => number, min: number, max: number) {
    return Math.floor(rnd() * (max - min + 1)) + min;
}

export function seededRand(seed: string): () => number {
    // xorshift32 via seed->uint32 (FNV-ish)
    let x = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        x ^= seed.charCodeAt(i);
        x = Math.imul(x, 16777619);
    }
    x >>>= 0;

    return () => {
        x ^= x << 13;
        x >>>= 0;
        x ^= x >> 17;
        x >>>= 0;
        x ^= x << 5;
        x >>>= 0;
        return (x >>> 0) / 4294967296;
    };
}

export function hslToHex(h: number, s: number, l: number) {
    s /= 100;
    l /= 100;

    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));

    const r = Math.round(255 * f(0));
    const g = Math.round(255 * f(8));
    const b = Math.round(255 * f(4));

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(v: number) {
    return v.toString(16).padStart(2, "0");
}

export function startIntervalEditor(params: {
    uuid?: string;
    intervalMs: number;
    getText: () => string;
    editFn: (text: string) => Promise<void>;
    onStop?: () => Promise<void>;
}) {
    let lastSent = "";
    let stopped = false;
    let inFlight: Promise<void> = Promise.resolve();

    const runTick = async () => {
        if (stopped /*|| (params.uuid && getOllamaRequest(params.uuid)?.done)*/) return;
        const next = params.getText();
        if (!next || next === lastSent) return;

        try {
            await params.editFn(next);
            lastSent = next;
        } catch (error) {
            const description = error instanceof Error ? error.message : String(error);
            if (description.includes("message is not modified")) return;
            logError("edit failed: " + description);
        }
    };

    const tick = async () => {
        inFlight = inFlight.then(runTick, runTick);
        return inFlight;
    };

    const timer = setInterval(() => {
        tick().catch(logError);
    }, params.intervalMs);

    return {
        tick,
        stop: async () => {
            stopped = true;
            clearInterval(timer);
            await inFlight;
            await params.onStop?.();
        },
    };
}

export function boolToInt(bool: boolean | undefined): number {
    return bool ? 1 : 0;
}

type RuntimeInfo =
    | { runtime: "bun"; version: string }
    | { runtime: "node"; version: string }
    | { runtime: "other"; version: string };

export function getRuntimeInfo(): RuntimeInfo {
    const v = process.versions ?? {};

    if (typeof v.bun === "string") {
        return {runtime: "bun", version: v.bun};
    }
    if (typeof v.node === "string") {
        return {runtime: "node", version: v.node};
    }

    return {runtime: "other", version: String(process.version ?? "")};
}

export type PhotoMaxSize = { width: number, height: number, url: string; file_id: string; unique_file_id: string; };

export function getPhotoMaxSize(photos: PhotoSize[] | undefined, target: number = Environment.MAX_PHOTO_SIZE): PhotoSize | null {
    if (!photos) return null;

    photos = photos.filter(p => Math.max(p.width, p.height) <= target);

    if (photos.length === 0) return null;

    if (photos.length === 1) {
        return photos[0];
    }

    return photos.reduce((prev, cur) => {
        if (!prev) return cur;
        return cur.width * cur.height > prev.width * prev.height ? cur : prev;
    });
}

export async function mapPhotoSizeToMax(size: PhotoSize | null): Promise<PhotoMaxSize | null> {
    if (!size) return null;
    return {
        width: size.width,
        height: size.height,
        url: await getFileUrl(size.file_id),
        file_id: size.file_id,
        unique_file_id: size.file_unique_id
    };
}

export async function imageToBase64(filePath: string, withMimeType: boolean = false): Promise<string | null> {
    if (!fs.existsSync(filePath)) return null;

    try {
        const file = fs.readFileSync(filePath);
        const base64 = Buffer.from(file).toString("base64");
        if (withMimeType) {
            return `data:image/jpeg;base64,${base64}`;
        }

        return base64;
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        return null;
    }
}

export function ifTrue(exp?: string | number | boolean): boolean {
    if (!exp) return false;

    if (typeof exp === "boolean") return exp;

    const normalized = exp.toString().toLowerCase().trim();
    return ["true", "t", "y", "1"].includes(normalized);
}


export function boolToEmoji(bool: boolean | undefined): string {
    return !!bool ? "✅" : "❌";
}

type AlbumCacheEntry = {
    messages: Message[];
    timer: NodeJS.Timeout;
    resolve: (value: boolean) => void;
    storedMsg: StoredMessage | null;
};

export const albumCache = new Map<string, AlbumCacheEntry>();

type AlbumProcessingResult = {
    photoUniqueIds?: string[] | null;
    attachments: StoredAttachment[];
    text?: string | null;
};

async function collectAlbumStoredAttachments(entry: AlbumCacheEntry): Promise<StoredAttachment[]> {
    const storedMessages = await Promise.all(
        entry.messages.map(message => MessageStore.get(message.chat.id, message.message_id))
    );

    return uniqueStoredAttachments(storedMessages.flatMap(message => message?.attachments ?? []));
}

function collectAlbumText(messages: Message[]): string | null {
    const parts = messages
        .map(message => extractTextMessage(message))
        .filter((text): text is string => !!text?.trim());

    return parts.length ? parts.join("\n").trim() : null;
}

async function processAlbum(albumKey: string): Promise<AlbumProcessingResult | undefined> {
    const entry = albumCache.get(albumKey);
    if (!entry) return;

    const allPhotos = entry.messages
        .filter(m => m.photo)
        .map(m => m.photo);

    const allPhotoMaxSizes = await Promise.all(allPhotos.map(photo => getPhotoMaxSize(photo)).filter(s => !!s));
    const ids = await loadImagesFromFileIds(allPhotoMaxSizes);
    const attachments = await collectAlbumStoredAttachments(entry);
    const text = collectAlbumText(entry.messages);

    albumCache.delete(albumKey);
    return {photoUniqueIds: ids, attachments, text};
}

function scheduleAlbumProcessing(albumKey: string, delayMs = 1000): NodeJS.Timeout {
    return setTimeout(async () => {
        const entry = albumCache.get(albumKey);
        try {
            const album = await processAlbum(albumKey);
            if (entry?.storedMsg) {
                entry.storedMsg.attachments = uniqueStoredAttachments([
                    ...(entry.storedMsg.attachments ?? []),
                    ...(album?.photoUniqueIds ?? []).map(uniqueId => createStoredImageAttachment({
                        fileId: uniqueId,
                        fileUniqueId: uniqueId,
                        cachePath: photoCachePathForUniqueId(uniqueId),
                    })),
                    ...(album?.attachments ?? []),
                ]);
                if (album?.text) {
                    entry.storedMsg.text = album.text;
                }
                await MessageStore.put(entry.storedMsg).catch(logError);
            }

            if (entry && album?.attachments.length) {
                await Promise.all(entry.messages.map(async message => {
                    const stored = await MessageStore.get(message.chat.id, message.message_id);
                    if (!stored) return;

                    stored.attachments = uniqueStoredAttachments([
                        ...(stored.attachments ?? []),
                        ...(album.photoUniqueIds ?? []).map(uniqueId => createStoredImageAttachment({
                            fileId: uniqueId,
                            fileUniqueId: uniqueId,
                            cachePath: photoCachePathForUniqueId(uniqueId),
                        })),
                        ...album.attachments,
                    ]);
                    if (album.text) {
                        stored.text = album.text;
                    }
                    await MessageStore.put(stored).catch(logError);
                }));
            }
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
        } finally {
            albumCache.delete(albumKey);
            entry?.resolve(true);
        }
    }, delayMs);
}

export function photoPathByUniqueId(uniqueId: string): string {
    return photoCachePathForUniqueId(uniqueId);
}

export async function processMyChatMember(u: ChatMemberUpdated): Promise<void> {
    messageLogger.debug("my_chat_member", {update: u});
}

export async function processGuestMessage(msg: Message): Promise<void> {
    // return processNewMessage(msg, true);
    messageLogger.debug("guest_message.received", {message: msg});
}

export async function processNewMessage(msg: Message, isGuest?: boolean): Promise<void> {
    messageLogger.debug(isGuest ? "guest_message.received" : "message.received", {message: msg});

    if (!msg.from) {
        messageLogger.debug("message.skipped.no_sender", {chatId: msg.chat?.id, messageId: msg.message_id});
        return;
    }

    const startedAt = Date.now();
    const from = msg.from;
    Environment.reloadRuntimeConfigIfChanged();

    let storedMsg: StoredMessage | null = null;
    let locale = Localization.resolveLocale(undefined, from.language_code);

    try {
        const results = await Promise.all([
                MessageStore.put(msg),
                UserStore.put(from)
            ]
        );
        messageLogger.debug("message.persisted", {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            fromId: from.id,
            duration: logger.duration(startedAt)
        });

        storedMsg = results[0];
        locale = await resolveInterfaceLocaleForUser(from.id, from.language_code);
        const attachmentPipeline = await runTelegramMessageAttachmentPipeline(msg, storedMsg);
        storedMsg = attachmentPipeline.storedMessage;
        const rejected = attachmentPipeline.rejected;
        if (rejected.length) {
            await Localization.runWithLocale(locale, async () => {
                await replyToMessage({
                    message: msg,
                    text: rejected
                        .map(attachment => Environment.getTelegramFileTooLargeText(
                            attachment.fileName,
                            attachment.limitBytes / 1024 / 1024,
                        ))
                        .join("\n"),
                }).catch(logError);
            });
        }

        if (!msg.media_group_id && msg.photo?.length) {
            await loadImagesIfExists(msg);
        }
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
    }

    await Localization.runWithLocale(locale, async () => {
        if ((msg.new_chat_members?.length)) {
            const text = randomValue(Environment.ANSWERS.invite);
            if (text) {
                await enqueueTelegramApiCall(
                    () => bot.sendMessage({chat_id: msg.chat.id, text}),
                    {method: "sendMessage", chatId: msg.chat.id, chatType: msg.chat.type}
                ).catch(logError);
            }
            return;
        }

        if (msg.left_chat_member && msg.left_chat_member.id !== botUser.id) {
            const text = randomValue(Environment.ANSWERS.kick);
            if (text) {
                await enqueueTelegramApiCall(
                    () => bot.sendMessage({chat_id: msg.chat.id, text}),
                    {method: "sendMessage", chatId: msg.chat.id, chatType: msg.chat.type}
                ).catch(logError);
            }
            return;
        }

        if (Environment.MUTED_IDS.has(from.id)) return;

        if (msg.forward_origin) return;

        const groupId = msg.media_group_id;
        if (groupId) {
            const albumKey = `${msg.chat.id}:${groupId}`;
            const shouldContinue = await new Promise<boolean>(resolve => {
                if (!albumCache.has(albumKey)) {
                    albumCache.set(albumKey, {
                        messages: [msg],
                        timer: scheduleAlbumProcessing(albumKey),
                        resolve,
                        storedMsg,
                    });
                } else {
                    const entry = albumCache.get(albumKey);
                    if (entry) {
                        entry.messages.push(msg);
                        clearTimeout(entry.timer);
                        entry.timer = scheduleAlbumProcessing(albumKey);
                    }
                    resolve(false);
                }
            });

            if (!shouldContinue) return;

            storedMsg = await MessageStore.get(msg.chat.id, msg.message_id) ?? storedMsg;
        }

        const cmdText = storedMsg?.text || msg.text || msg.caption || "";

        const cmd = searchChatCommand(commands, cmdText);
        const executed = await executeChatCommand(cmd, msg, cmdText);

        const hasAudioAttachment = !!msg.voice || !!msg.audio || !!msg.document?.mime_type?.startsWith("audio/")
            || !!msg.video_note;
        const hasImageAttachment = !!msg.photo?.length || !!msg.document?.mime_type?.startsWith("image/");
        if (executed) {
            messageLogger.debug("message.command_executed", {
                chatId: msg.chat.id,
                messageId: msg.message_id,
                command: cmd?.title
            });
            return;
        }

        if (!cmdText && !hasAudioAttachment && !hasImageAttachment) {
            messageLogger.debug("message.skipped.empty", {chatId: msg.chat.id, messageId: msg.message_id});
            return;
        }

        const hasConfiguredPrefix = Environment.BOT_PREFIX.length > 0;
        const startsWithPrefix = hasConfiguredPrefix && cmdText.toLowerCase().startsWith(Environment.BOT_PREFIX.toLowerCase());
        const messageWithoutPrefix = startsWithPrefix ? cmdText.substring(Environment.BOT_PREFIX.length).trim() : cmdText.trim();

        if (startsWithPrefix && messageWithoutPrefix.length === 0) {
            const prefixResponse = new PrefixResponse();
            if (await checkRequirements(prefixResponse, msg)) {
                await prefixResponse.execute(msg);
            }
            return;
        }

        const textToCheck = startsWithPrefix ? messageWithoutPrefix : cmdText;

        if (msg.chat.type !== "private") {
            if (Environment.ONLY_FOR_CREATOR_MODE && from.id !== Environment.CREATOR_ID) {
                return;
            }

            const isReplyToBot = !!msg.reply_to_message && msg.reply_to_message.from?.id === botUser.id;
            const hasPrefix = startsWithPrefix;
            const hasBotMention = !!msg.entities?.some(entity => {
                if (entity.type !== "mention") return false;
                const mention = msg.text?.slice(entity.offset, entity.offset + entity.length) ?? msg.caption?.slice(entity.offset, entity.offset + entity.length) ?? "";
                return mention.toLowerCase() === `@${botUser.username?.toLowerCase()}`;
            });

            if (!isReplyToBot && !hasPrefix && !hasBotMention && !hasAudioAttachment) {
                messageLogger.debug("message.skipped.not_addressed", {chatId: msg.chat.id, messageId: msg.message_id});
                return;
            }
        }

        const provider = await resolveEffectiveAiProviderForUser(from.id);

        messageLogger.info("ai.dispatch", {chatId: msg.chat.id, messageId: msg.message_id, fromId: from.id, provider});
        void runUnifiedAi({
            provider: provider,
            msg: msg,
            isGuestMsg: !!isGuest,
            text: textToCheck,
            stream: true,
        }).catch(logError);
    });
}

export async function processEditedMessage(msg: Message): Promise<void> {
    if (!msg.from) return;

    Environment.reloadRuntimeConfigIfChanged();

    await UserStore.put(msg.from);

    if (!extractTextMessage(msg) || msg.from.id === botUser.id) return;

    await MessageStore.put(msg);
}

export async function processInlineQuery(query: InlineQuery): Promise<void> {
    Environment.reloadRuntimeConfigIfChanged();
    const locale = await resolveInterfaceLocaleForUser(query.from.id, query.from.language_code);

    await Localization.runWithLocale(locale, async () => {
        if (Environment.CREATOR_ID !== query.from.id) {
            await enqueueTelegramApiCall(
                () => bot.answerInlineQuery({
                    inline_query_id: query.id,
                    results: [],
                    button: {
                        text: Environment.noAccessText,
                        start_parameter: "nope"
                    }
                }),
                {method: "answerInlineQuery", skipPerChatLimit: true}
            ).catch(logError);
            return;
        }

        if (query.query.trim().length !== 0) {
            try {
                const target = resolveAiRuntimeTarget(AiProvider.OLLAMA, "chat");
                const results = await createOllamaClient(target).webSearch({query: query.query, maxResults: 10});
                const queryResults: InlineQueryResult[] = (results.results ?? []).map((result, index) => {
                    const content = result.content.trim();
                    const [firstLine] = content.split("\n");
                    const title = firstLine?.trim().slice(0, 128) || query.query;

                    return {
                        type: "article" as const,
                        id: `ollama-search-${index}`,
                        title,
                        description: content.slice(0, 256),
                        input_message_content: {
                            message_text: content,
                        }
                    };
                });

                await enqueueTelegramApiCall(
                    () => bot.answerInlineQuery({
                        inline_query_id: query.id,
                        results: queryResults,
                        cache_time: 60,
                        is_personal: true,
                    }),
                    {method: "answerInlineQuery", skipPerChatLimit: true}
                );
            } catch (e) {
                logError(e instanceof Error ? e : String(e));
                await enqueueTelegramApiCall(
                    () => bot.answerInlineQuery({
                        inline_query_id: query.id,
                        results: [],
                        cache_time: 0,
                        is_personal: true,
                    }),
                    {method: "answerInlineQuery", skipPerChatLimit: true}
                ).catch(logError);
            }
        } else {
            await enqueueTelegramApiCall(
                () => bot.answerInlineQuery({
                    inline_query_id: query.id,
                    results: [],
                }),
                {method: "answerInlineQuery", skipPerChatLimit: true}
            ).catch(logError);
        }
    });
}

export async function processCallbackQuery(query: CallbackQuery): Promise<void> {
    Environment.reloadRuntimeConfigIfChanged();
    const locale = await resolveInterfaceLocaleForUser(query.from.id, query.from.language_code);
    await Localization.runWithLocale(locale, () => findAndExecuteCallbackCommand(callbackCommands, query));
}

export async function runCommand(cmd: string): Promise<ShellCommandResult> {
    return ShellCommandRunner.run(cmd);
}
