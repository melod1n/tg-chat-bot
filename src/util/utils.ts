import * as si from "systeminformation";
import {ChatCommand} from "../base/chat-command";
import {CallbackCommand} from "../base/callback-command";
import {
    CallbackQuery,
    ChatMember,
    InlineKeyboardMarkup,
    Message,
    ParseMode,
    PhotoSize,
    User
} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";
import {TelegramError} from "typescript-telegram-bot-api/dist/errors";
import {bot, botUser, chatCommands, messageDao} from "../index";
import os from "os";
import axios from "axios";
import {MessagePart} from "../common/message-part";
import {StoredMessage} from "../model/stored-message";
import sharp from "sharp";
import {UserStore} from "../common/user-store";
import * as orm from "drizzle-orm";
import {sql, type SQL} from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import {MessageStore} from "../common/message-store";
import {SystemInfo} from "../commands/system-info";
import {PrefixResponse} from "../commands/prefix-response";
import {OllamaChat} from "../commands/ollama-chat";
import {getYouTubeVideoId} from "./ytdl";
import {YouTubeDownload} from "../commands/youtube-download";

export const ignore = () => {
};

export const ignoreIfNotChanged = (e: Error | TelegramError) => {
    if (!(e instanceof TelegramError && e?.response?.description?.startsWith("Bad Request: message is not modified"))) {
        throw e;
    }
};

export const ignoreIfMarkupFailed = (e: Error | TelegramError) => {
    if (!(e instanceof TelegramError && e?.response?.description?.startsWith("Bad Request: can't parse entities"))) {
        throw e;
    }
};

export const logError = (e: Error | TelegramError | string) => {
    console.error(e);
};

export const errorPlaceholder = async (msg: Message) => {
    await sendErrorPlaceholder(msg).catch(logError);
};

export function searchChatCommand(
    commands: ChatCommand[],
    text: string,
    botUsername: string = botUser.username
): ChatCommand | null {
    for (const command of commands) {
        const match = command.finalRegexp.exec(text);
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

export async function checkRequirements(cmd: ChatCommand | CallbackCommand | null, msg?: Message, cb?: CallbackQuery): Promise<boolean> {
    if (!cmd) return false;
    if (!msg && !cb) return false;

    const isChatCommand = "title" in cmd;
    const isCallbackCommand = "data" in cmd;
    let title: string;

    if (isChatCommand) {
        title = cmd.title;
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
        console.log(`${title}: chatId whitelist ignored.`);
        return false;
    }

    const reqs = cmd.requirements;
    if (!reqs) return true;

    const notifyUser = async (text: string) => {
        if (msg) {
            await replyToMessage({chat_id: chatId, message_id: messageId, text: text});
        } else if (cb) {
            await bot.answerCallbackQuery({
                callback_query_id: cbId,
                text: text,
                cache_time: 0,
                show_alert: true
            }).catch(logError);
        }
    };

    if (reqs.isRequiresBotCreator() && fromId !== Environment.CREATOR_ID) {
        console.log(`${title}: creatorId is bad`);
        await notifyUser("Вы не являетесь создателем бота.");
        return false;
    }

    if (reqs.isRequiresBotAdmin() && !Environment.ADMIN_IDS.has(fromId)) {
        console.log(`${title}: adminId is bad`);
        await notifyUser("Вы не являетесь администратором бота.");
        return false;
    }

    if (reqs.isRequiresChat() && msg.chat.type === "private") {
        console.log(`${title}: chatId is bad`);
        await notifyUser("Тут Вам не чат.");
        return false;
    }

    if (reqs.isRequiresChatAdmin()) {
        const member = await bot.getChatMember({chat_id: chatId, user_id: fromId});

        if (!isMemberAdmin(member)) {
            console.log(`${title}: chatAdminId is bad`);
            await notifyUser("Вы не являетесь администратором чата.");
            return false;
        }
    }

    if (reqs.isRequiresBotChatAdmin() && chatType !== "private") {
        const member = await bot.getChatMember({chat_id: chatId, user_id: botUser.id});

        if (!isMemberAdmin(member)) {
            console.log(`${title}: botChatAdminId is bad`);
            await notifyUser("Бот не является администратором чата.");
            return false;
        }
    }

    if (reqs.isRequiresReply() && !msg?.reply_to_message) {
        console.log(`${title}: replyMessage is bad`);
        await notifyUser("Отсутствует ответ на сообщение.");
        return false;
    }

    if (reqs.isRequiresSameUser()) {
        let originalFromId: number | null;
        try {
            const queryMessage = await MessageStore.get(chatId, messageId);
            if (queryMessage && queryMessage.replyToMessageId) {
                const originalMessage = await MessageStore.get(chatId, queryMessage.replyToMessageId);
                originalFromId = originalMessage?.fromId;
            }
        } catch (e) {
            logError(e);
            originalFromId = null;
        }

        if (originalFromId && fromId !== originalFromId && fromId !== Environment.CREATOR_ID) {
            console.log(`${title}: sameUser is bad`);
            await notifyUser("Только автор оригинального сообщения может выполнить это действие.");
            return false;
        }
    }

    return true;
}

export async function executeChatCommand(cmd: ChatCommand | null, msg: Message, text: string): Promise<boolean> {
    if (!cmd) return false;

    if (!await checkRequirements(cmd, msg)) return false;

    await cmd.execute(msg, cmd.regexp.exec(text));
    return true;
}

export async function findAndExecuteCallbackCommand(commands: CallbackCommand[], query: CallbackQuery): Promise<boolean> {
    const data = query.data || "";

    const cmd = searchCallbackCommand(commands, data);
    if (!cmd) return false;

    if (!await checkRequirements(cmd, null, query)) return false;

    await cmd.execute(query);
    await cmd.answerCallbackQuery(query);
    await cmd.afterExecute(query);
    return true;
}

export async function editMessageText(chatId: number, messageId: number, messageText: string, parseMode?: ParseMode, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
    if (messageText.trim().length === 0) return Promise.resolve();
    try {
        await bot.editMessageText({
            chat_id: chatId,
            message_id: messageId,
            text: messageText,
            parse_mode: parseMode,
            link_preview_options: {
                is_disabled: true
            },
            reply_markup: replyMarkup
        }).catch(ignoreIfMarkupFailed);
        return Promise.resolve();
    } catch (e) {
        logError(e);

        if (e instanceof TelegramError && e.response.description.includes("Too Many Requests")) {
            const delay = Number(e.message.split("retry after ")[1]) || 30;
            setTimeout(() => {
                return Promise.resolve();
            }, delay * 1000);
        } else if (e instanceof TelegramError && e.response.description.includes("MESSAGE_TOO_LONG")) {
            return Promise.reject(e);
        } else {
            return Promise.resolve();
        }
    }
}

export type SendOptions = {
    chat_id?: number;
    message?: Message,
    message_id?: number;
    text: string,
    parse_mode?: ParseMode,
    disableLinkPreview?: boolean
};

export async function oldSendMessage(message: Message, text: string, parseMode?: ParseMode): Promise<Message> {
    const response = await bot.sendMessage({
        chat_id: message.chat.id,
        text: text,
        parse_mode: parseMode
    });

    return Promise.resolve(response);
}

export async function sendMessage(options: SendOptions): Promise<Message> {
    const response = await bot.sendMessage({
        chat_id: options.chat_id ?? options.message?.chat?.id,
        text: options.text,
        parse_mode: options.parse_mode,
        link_preview_options: {
            is_disabled: options.disableLinkPreview
        }
    });

    return Promise.resolve(response);
}

export async function replyToMessage(options: SendOptions): Promise<Message> {
    const response = await bot.sendMessage({
        chat_id: options.chat_id ?? options.message?.chat?.id,
        text: options.text,
        parse_mode: options.parse_mode,
        reply_parameters: {
            message_id: options.message_id || options.message?.message_id
        },
        link_preview_options: {
            is_disabled: options.disableLinkPreview
        }
    });

    return Promise.resolve(response);
}

export async function oldReplyToMessage(message: Message, text: string, parseMode?: ParseMode): Promise<Message> {
    const response = await bot.sendMessage({
        chat_id: message.chat.id,
        text: text,
        reply_parameters: {
            message_id: message.message_id
        },
        parse_mode: parseMode,
    });

    return Promise.resolve(response);
}

export async function sendErrorPlaceholder(message: Message): Promise<Message> {
    return await sendMessage({message: message, text: "Произошла ошибка ⚠️"}).catch(logError) as Message;
}

export async function initSystemSpecs(): Promise<void> {
    try {
        const [os, cpu, mem] = await Promise.all([si.osInfo(), si.cpu(), si.mem()]);
        const run = getRuntimeInfo();

        const ramSize = (mem.total / 1024 / 1024 / 1024).toFixed(2);

        const text =
            `OS: ${os.distro}\n` +
            `RUNTIME: ${run.runtime} ${run.version}\n` +
            `DOCKER: ${Environment.IS_DOCKER}\n` +
            `CPU: ${cpu.manufacturer} ${cpu.brand} ${cpu.physicalCores} cores ${cpu.cores} threads\n` +
            `RAM: ${ramSize} GB`;

        SystemInfo.setSystemInfo(text);
        return Promise.resolve();
    } catch (e) {
        return Promise.reject(e);
    }
}

export function getRandomInt(max: number) {
    return Math.floor(Math.random() * Math.floor(max));
}

export function getRangedRandomInt(from: number, to: number): number {
    return getRandomInt(to - from) + from;
}

export function randomValue<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

export function chatCommandToString(cmd: ChatCommand): string {
    if (!cmd.title && !cmd.description) {
        return "";
    }

    if (cmd.title && cmd.description) {
        return `${cmd.title}: ${cmd.description}`;
    }

    return `${cmd.title ? `${cmd.title}: ` : ""}${cmd.description ? `${cmd.description}` : ""}`;
}

export function fullName(from: User): string {
    let fullName = from.first_name;

    if (from.last_name) {
        fullName += " " + from.last_name;
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

    const processUptimeText = `${processDays > 0 ? `${processDays} д. ` : ""}` +
        `${processHours > 0 ? `${processHours} ч. ` : ""}` +
        `${processMinutes > 0 ? `${processMinutes} м. ` : ""}` +
        `${processSeconds > 0 ? `${processSeconds} с.` : ""}`;

    const osUptime = Math.ceil(os.uptime());

    const osDays = Math.floor(osUptime / (3600 * 24));
    const osHours = Math.floor((osUptime % (3600 * 24)) / 3600);
    const osMinutes = Math.floor((osUptime % 3600) / 60);
    const osSeconds = Math.floor(osUptime % 60);

    const osUptimeText = `${osDays > 0 ? `${osDays} д. ` : ""}` +
        `${osHours > 0 ? `${osHours} ч. ` : ""}` +
        `${osMinutes > 0 ? `${osMinutes} м. ` : ""}` +
        `${osSeconds > 0 ? `${osSeconds} с.` : ""}`;

    return `${Environment.IS_DOCKER ? "Docker контейнер" : "Процесс"}:\n${processUptimeText}\n\nСистема:\n${osUptimeText}`;
}

export const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }

        const id = setTimeout(resolve, ms);

        if (signal) {
            const onAbort = () => {
                clearTimeout(id);
                reject(new DOMException("Aborted", "AbortError"));
            };
            signal.addEventListener("abort", onAbort, {once: true});
        }
    });

export function escapeMarkdownV2Text(s: string) {
    s = s.replace(/^\*{3,}\s*$/gm, "— — —");
    s = s.replace(/^\*\s+(?=\S)/gm, "• ");
    s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");

    return s;
}

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

export function extractTextMessage(msg: Message | StoredMessage | string): string | null {
    const text = (typeof msg === "string" ? msg : isStoredMessage(msg) ? msg.text : msg?.text ?? msg?.caption ?? "").trim();
    if (text.length === 0) return null;
    return text;
}

export function cutPrefixes(msg: Message | StoredMessage | string): string {
    const prefixes = [
        Environment.BOT_PREFIX,
        `/ollamathink@${botUser.username}`,
        "/ollamathink",
        `/ollama@${botUser.username}`,
        "/ollama",
        `/gemini@${botUser.username}`,
        "/gemini",
        `/mistral@${botUser.username}`,
        "/mistral",
    ];

    const text = extractTextMessage(msg);
    let newText = text;

    for (const prefix of prefixes) {
        if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
            newText = newText.substring(prefix.length).trim();
            break;
        }
    }

    return newText;
}

export function isStoredMessage(msg: Message | StoredMessage): msg is StoredMessage {
    return "id" in msg;
}

export async function loadImagesIfExists(msg: Message | StoredMessage): Promise<string[] | null> {
    if (isStoredMessage(msg)) {
        return msg.photoMaxSizeFilePath;
    }

    if (!msg.photo?.length) return;

    const imageFilePaths: string[] = [];

    for (const size of msg.photo) {
        const exists = fs.existsSync(photoPathByUniqueId(size.file_unique_id));
        if (exists) {
            return [size.file_unique_id];
        }
    }

    const maxSize = await mapPhotoSizeToMax(getPhotoMaxSize(msg.photo));
    if (maxSize) {
        const imagePath = path.join(Environment.DATA_PATH, "photo");
        if (!fs.existsSync(imagePath)) {
            fs.mkdirSync(imagePath);
        }

        let imageFilePath = path.join(imagePath, maxSize.unique_file_id + ".jpg");
        if (!fs.existsSync(imageFilePath)) {
            const res = await axios.get<ArrayBuffer>(maxSize.url, {responseType: "arraybuffer"});
            const src = Buffer.from(res.data);

            try {
                fs.writeFileSync(imageFilePath, src);
            } catch (e) {
                logError(e);
                imageFilePath = null;
            }
        }

        if (imageFilePath) {
            imageFilePaths.push(imageFilePath);
        }
    }

    return imageFilePaths;
}

export async function loadImagesFromFileIds(sizes: PhotoSize[]): Promise<string[] | null> {
    if (!sizes?.length) return null;

    const dataPath = path.join(Environment.DATA_PATH, "photo");
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath);
    }

    const existing =
        sizes.filter(s => fs.existsSync(photoPathByUniqueId(s.file_unique_id)))
            .map(s => s.file_unique_id);

    const promises = sizes.filter(s => !fs.existsSync(photoPathByUniqueId(s.file_unique_id)))
        .map(s => mapPhotoSizeToMax(s));

    const maxSizes = await Promise.all(promises);

    const imagePromises = maxSizes.map((size) => {
        return axios.get<ArrayBuffer>(size.url, {responseType: "arraybuffer"});
    });

    const responses = await Promise.all(imagePromises);
    const paths = responses.map((res, index) => {
        try {
            const uniqueFileId = maxSizes[index].unique_file_id;
            const imageFilePath = path.join(dataPath, uniqueFileId + ".jpg");
            const src = Buffer.from(res.data);
            fs.writeFileSync(imageFilePath, src);
            return uniqueFileId;
        } catch (e) {
            logError(e);
            return null;
        }
    });
    const finalPaths = paths.filter(p => p);
    finalPaths.unshift(...existing);
    return finalPaths;
}

export async function collectReplyChainText(triggerMsg: Message | StoredMessage, limit: number = 40, includeTrigger = true, cutPrefix: boolean = true): Promise<MessagePart[]> {
    const parts: MessagePart[] = [];

    const pushPart = async (msg: Message | StoredMessage, textRequired: boolean = false) => {
        const rawText = extractTextMessage(msg);
        const cleanText = cutPrefix ? cutPrefixes(rawText) : rawText;
        const imageNames = await loadImagesIfExists(msg);

        if (!cleanText && textRequired) return;
        if (!cleanText && !imageNames?.length) return;

        const fromId = isStoredMessage(msg) ? msg.fromId : msg.from.id;
        const firstName = isStoredMessage(msg) ?
            (await UserStore.get(msg.fromId))?.firstName : msg.from.first_name;

        const images = imageNames ? imageNames.map(n => {
            const filePath = photoPathByUniqueId(n);
            return Buffer.from(fs.readFileSync(filePath)).toString("base64");
        }) : null;

        parts.push({
            bot: fromId === botUser.id,
            content: cleanText ? cleanText : "",
            name: firstName,
            images: images ? images : []
        });
    };

    const chatId = isStoredMessage(triggerMsg) ? triggerMsg.chatId as number : triggerMsg.chat.id;

    if (includeTrigger) {
        await pushPart(triggerMsg);
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
    const channels = info.channels!; // обычно 4 (RGBA)

    const out = Buffer.alloc(data.length);

    for (let y = 0; y < height; y++) {
        const dx = amp * Math.sin((2 * Math.PI * y) / wavelength + phase1);

        for (let x = 0; x < width; x++) {
            const dy = amp2 * Math.sin((2 * Math.PI * x) / wavelength2 + phase2);

            const sx = Math.round(x + dx);
            const sy = Math.round(y + dy);

            const di = (y * width + x) * channels;

            if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
                // прозрачный пиксель
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
}

export async function downloadTelegramFile(filePath: string): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${Environment.BOT_TOKEN}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
}

export function extractImageFileId(reply: Message): string | null {
    // photo (сжатое)
    if (reply.photo?.length) {
        return reply.photo[reply.photo.length - 1]!.file_id; // самое большое
    }
    // document (обычно оригинал)
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

    // случайный угол градиента
    const x1 = rnd(), y1 = rnd();
    const x2 = 1 - x1, y2 = 1 - y1;

    // мягкое свечение
    const glowHue = (hue1 + rndInt(rnd, -25, 25) + 360) % 360;
    const glowColor = hslToHex(glowHue, 60, 60);
    const glowCx = 0.35 + rnd() * 0.30;
    const glowCy = 0.30 + rnd() * 0.35;
    const glowR = 0.55 + rnd() * 0.25;
    const glowOpacity = 0.14 + rnd() * 0.10;

    // виньетка
    const vignetteStrength = 0.55 + rnd() * 0.15;

    // зерно
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

    <!-- зерно: чёрный шум с маленькой альфой -->
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
      <!-- масштабируем альфу (интенсивность зерна) -->
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
        .blur(0.6) // чуть сгладить градиент/свечение (зерно тоже мягче)
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

    const tick = async () => {
        if (stopped /*|| (params.uuid && getOllamaRequest(params.uuid)?.done)*/) return;
        const next = params.getText();
        if (!next || next === lastSent) return;

        console.log("tick");

        try {
            await params.editFn(next);
            lastSent = next;
        } catch (e) {
            if ((e?.description ?? e?.message ?? "").includes("message is not modified")) return;
            logError("edit failed: " + e);
        }
    };

    const timer = setInterval(async () => await tick(), params.intervalMs);

    return {
        tick,
        stop: async () => {
            stopped = true;
            clearInterval(timer);
            await params.onStop?.();
        },
    };
}

export function boolToInt(bool: boolean): number {
    return bool ? 1 : 0;
}

type AnyDrizzleTable = {
    _: {
        columns: Record<string, { name: string }>;
    };
};

export function buildExcludedSet<
    T extends AnyDrizzleTable,
    K extends keyof T["_"]["columns"] & string,
    E extends readonly K[] = readonly []
>(table: T, exclude: E = [] as unknown as E): Record<Exclude<K, E[number]>, SQL> {
    const cols = orm.getColumns(table as never) as T["_"]["columns"];
    const excludeSet = new Set<string>(exclude as readonly string[]);

    const entries = Object.keys(cols)
        .filter((key) => !excludeSet.has(key))
        .map((key) => {
            const realName = (cols as unknown)[key].name; // actual DB column name
            return [key, sql.raw(`excluded.${realName}`)] as const;
        });

    return Object.fromEntries(entries) as Record<Exclude<K, E[number]>, SQL>;
}

type RuntimeInfo =
    | { runtime: "bun"; version: string }
    | { runtime: "node"; version: string }
    | { runtime: "unknown"; version: string };

export function getRuntimeInfo(): RuntimeInfo {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (process as any).versions ?? {};

    if (typeof v.bun === "string") {
        return {runtime: "bun", version: v.bun};
    }
    if (typeof v.node === "string") {
        return {runtime: "node", version: v.node};
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {runtime: "unknown", version: String((process as any).version ?? "")};
}

export type PhotoMaxSize = { width: number, height: number, url: string; file_id: string; unique_file_id: string; };

export function getPhotoMaxSize(photos: PhotoSize[], target: number = Environment.MAX_PHOTO_SIZE): PhotoSize | null {
    if (!photos) return null;

    photos = photos.filter(p => Math.max(p.width, p.height) <= target);

    if (photos.length === 0) return null;

    if (photos.length === 1) {
        return photos[0];
    }

    const max = photos.reduce((prev, cur) => {
        if (!prev) return cur;

        return cur.width * cur.height > prev.width * prev.height ? cur : prev;
    }, null);

    return max;
}

export async function mapPhotoSizeToMax(size: PhotoSize): Promise<PhotoMaxSize | null> {
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
        logError(e);
        return null;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ifTrue(exp?: any): boolean {
    if (!exp) return false;

    return ["true", "t", "y", 1, "1"].includes(exp);
}

export function boolToEmoji(bool: boolean): string {
    return bool ? "✅" : "❌";
}

export const albumCache = new Map<string, { messages: Message[], timer: NodeJS.Timeout }>();

export async function processNewMessage(msg: Message) {
    console.log("message", msg);

    let storedMsg: StoredMessage | null = null;

    try {
        const results = await Promise.all([
                MessageStore.put(msg),
                UserStore.put(msg.from)
            ]
        );

        storedMsg = results[0];
        if (!msg.media_group_id && storedMsg.photoMaxSizeFilePath) {
            await loadImagesIfExists(msg);
        }
    } catch (e) {
        logError(e);
    }

    if ((msg.new_chat_members?.length || 0 > 0)) {
        await bot.sendMessage({chat_id: msg.chat.id, text: randomValue(Environment.ANSWERS.invite)}).catch(logError);
        return;
    }

    if (msg.left_chat_member && msg.left_chat_member.id !== botUser.id) {
        await bot.sendMessage({chat_id: msg.chat.id, text: randomValue(Environment.ANSWERS.kick)}).catch(logError);
        return;
    }

    if (Environment.MUTED_IDS.has(msg.from.id)) return;

    if (msg.forward_origin) return;

    const groupId = msg.media_group_id;
    if (groupId) {
        await new Promise<true>(resolve => {
            if (!albumCache.has(groupId)) {
                albumCache.set(groupId, {
                    messages: [msg],
                    timer: setTimeout(async () => {
                        const photos = await processAlbum(groupId);
                        console.log("processedAlbum", photos);

                        storedMsg.photoMaxSizeFilePath = photos;
                        await MessageStore.put(storedMsg).catch(logError);
                        resolve(true);
                    }, 1000)
                });
            } else {
                const entry = albumCache.get(groupId);
                entry.messages.push(msg);
            }
        });
    }

    const cmdText = msg.text || msg.caption || "";

    const then = Date.now();

    const cmd = searchChatCommand(chatCommands, cmdText);
    const executed = await executeChatCommand(cmd, msg, cmdText);

    const now = Date.now();
    const diff = now - then;
    console.log("diff", diff);

    if (executed || !cmdText) return;

    const startsWithPrefix = cmdText.toLowerCase().startsWith(Environment.BOT_PREFIX.toLowerCase());
    const messageWithoutPrefix = cmdText.substring(Environment.BOT_PREFIX.length).trim();

    if (startsWithPrefix && messageWithoutPrefix.length === 0) {
        const prefixResponse = new PrefixResponse();
        if (await checkRequirements(prefixResponse, msg)) {
            await prefixResponse.execute(msg);
        }
        return;
    }

    const textToCheck = startsWithPrefix ? messageWithoutPrefix : cmdText;
    if (msg.entities) {
        const urlEntities = msg.entities.filter(e => e.type === "url");
        if (urlEntities.length) {
            for (const e of urlEntities) {
                const url = msg.text.substring(e.offset, e.offset + e.length);
                // TODO: 31/01/2026, Danil Nikolaev: implement proper checking
                try {
                    getYouTubeVideoId(url);

                    const yt = chatCommands.find(e => e instanceof YouTubeDownload);
                    if (await checkRequirements(yt, msg)) {
                        await yt.downloadYouTubeVideo(msg, url);
                    }
                    return;
                } catch (e) {
                    logError(e);
                }
            }
        }
    }

    if (!startsWithPrefix && msg.chat.type !== "private") return;
    if (msg.chat.type === "private" && !Environment.ADMIN_IDS.has(msg.chat.id)) return;

    const chat = chatCommands.find(e => e instanceof OllamaChat);
    if (await checkRequirements(chat, msg)) {
        await chat.executeOllama(msg, textToCheck);
    }
}

async function processAlbum(groupId: string): Promise<string[]> {
    const entry = albumCache.get(groupId);
    if (!entry) return;

    const allPhotos = entry.messages
        .filter(m => m.photo)
        .map(m => m.photo);

    const allPhotoMaxSizes = await Promise.all(allPhotos.map(photo => getPhotoMaxSize(photo)));
    const ids = await loadImagesFromFileIds(allPhotoMaxSizes);

    console.log(`Received album ${groupId} with ${ids.length} photos.`);
    console.log("File IDs:", ids);

    albumCache.delete(groupId);
    return ids;
}

export function photoPathByUniqueId(uniqueId: string): string {
    return path.join(Environment.DATA_PATH, "photo", uniqueId + ".jpg");
}