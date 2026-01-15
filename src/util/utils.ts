import * as si from "systeminformation";
import {ChatCommand} from "../base/chat-command";
import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery, InlineKeyboardMarkup, Message, ParseMode, PhotoSize, User} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";
import {TelegramError} from "typescript-telegram-bot-api/dist/errors";
import {bot, botUser, messageDao, setSystemInfo} from "../index";
import os from "os";
import axios from "axios";
import {MessagePart} from "../common/message-part";
import {StoredMessage} from "../model/stored-message";
import sharp from "sharp";
import {UserStore} from "../common/user-store";
import * as orm from "drizzle-orm";
import {sql, type SQL} from "drizzle-orm";

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

export const logError = (e: Error | TelegramError) => {
    console.error(e);
};

export const errorPlaceholder = async (msg: Message) => {
    await sendErrorPlaceholder(msg).catch(logError);
};

export function searchChatCommand(commands: ChatCommand[], text: string): ChatCommand | null {
    for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        if (command?.regexp.test(text)) {
            return command;
        }
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

export async function checkRequirements(cmd: ChatCommand | null, msg: Message): Promise<boolean> {
    if (!cmd) return false;

    const fromId = msg.from?.id || -1;

    if (Environment.CHAT_IDS_WHITELIST.size > 0 &&
        !Environment.CHAT_IDS_WHITELIST.has(msg.chat.id) &&
        !Environment.ADMIN_IDS.has(msg.chat.id) &&
        !Environment.ADMIN_IDS.has(msg.from.id)) {
        console.log(`${cmd.title}: chatId whitelist ignored.`);
        return false;
    }

    const reqs = cmd.requirements;
    if (!reqs) return true;

    if (reqs.isRequiresBotCreator() && fromId !== Environment.CREATOR_ID) {
        console.log(`${cmd.title}: creatorId is bad`);
        await replyToMessage(msg, "Вы не являетесь создателем бота.");
        return false;
    }

    if (reqs.isRequiresBotAdmin() && !Environment.ADMIN_IDS.has(fromId)) {
        console.log(`${cmd.title}: adminId is bad`);
        await replyToMessage(msg, "Вы не являетесь администратором бота.");
        return false;
    }

    if (reqs.isRequiresBotChatAdmin() && msg.chat.type !== "private") {
        const member = await bot.getChatMember({chat_id: msg.chat.id, user_id: botUser.id});
        const isAdmin = member.status === "administrator" || member.status === "creator";

        if (!isAdmin) {
            console.log(`${cmd.title}: chatAdminId is bad`);
            await replyToMessage(msg, "Бот не является администратором чата.");
            return false;
        }
    }

    if (reqs.isRequiresChat() && msg.chat.type === "private") {
        console.log(`${cmd.title}: chatId is bad`);
        await replyToMessage(msg, "Тут Вам не чат.");
        return false;
    }

    if (reqs.isRequiresReply() && !msg.reply_to_message) {
        console.log(`${cmd.title}: replyMessage is bad`);
        await replyToMessage(msg, "Отсутствует ответ на сообщение.");
        return false;
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
    const fromId = query.from.id;
    const data = query.data || "";

    const cmd = searchCallbackCommand(commands, data);
    if (!cmd) return false;

    // TODO: 15/01/2026, Danil Nikolaev: reimplement
    const requirements = cmd.requirements;
    if (requirements) {
        if (requirements.isRequiresBotAdmin() && !Environment.ADMIN_IDS.has(fromId)) {
            console.log(`${cmd.data}: adminId is bad: ${fromId}`);
            return false;
        }
    }

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
        console.error(e);

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
    chatId?: number;
    message?: Message,
    text: string,
    parseMode?: ParseMode,
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
        chat_id: options.chatId ?? options.message?.chat?.id,
        text: options.text,
        parse_mode: options.parseMode
    });

    return Promise.resolve(response);
}

export async function replyToMessage(message: Message, text: string, parseMode?: ParseMode): Promise<Message> {
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
    return await sendMessage({message: message, text: "Произошла ошибка ⚠️"}).catch(console.error) as Message;
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

        setSystemInfo(text);
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

export function extractTextMessage(msg: Message, prefix: string = ""): string | null {
    let text = (msg?.text ?? msg?.caption ?? "").trim();
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        text = text.substring(prefix.length);
    }

    text = text.trim();
    if (text.length === 0) return null;

    return text;
}

export function extractTextStored(msg: StoredMessage, prefix: string): string {
    let text = (msg?.text ?? "").trim();
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        text = text.substring(prefix.length).trim();
    }

    return text;
}

export function extractText(text: string, prefix: string): string {
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        text = text.substring(prefix.length).trim();
    }

    return text;
}

export async function collectReplyChainText(triggerMsg: Message, prefix: string = Environment.BOT_PREFIX, limit: number = 40, includeTrigger = true): Promise<MessagePart[]> {
    const chatId = triggerMsg.chat.id as number;

    const parts: MessagePart[] = [];
    if (includeTrigger) {
        const t = extractTextMessage(triggerMsg, prefix);
        if (t) parts.push({
            bot: triggerMsg.from.id === botUser.id,
            content: t,
            name: triggerMsg.from.first_name
        });
    }

    const first = triggerMsg.reply_to_message;
    if (!first) {
        return parts;
    }

    const firstText = extractTextMessage(first, prefix);
    if (firstText) parts.push({bot: first.from.id === botUser.id, content: firstText, name: first.from.first_name});

    let curId = first.message_id;

    while (parts.length < limit) {
        const cur = await messageDao.getById({chatId: chatId, id: curId});
        const parentId = cur?.replyToMessageId ?? null;
        if (!parentId) break;

        const parent = await messageDao.getById({chatId: chatId, id: parentId});
        if (!parent?.text) break;

        const user = await UserStore.get(parent.fromId);

        parts.push({
            bot: parent.fromId === botUser.id,
            content: extractTextStored(parent, prefix),
            name: user?.firstName
        });
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
    intervalMs: number;
    getText: () => string;
    editFn: (text: string) => Promise<void>;
    onStop: () => Promise<void>;
}) {
    let lastSent = "";
    let stopped = false;

    const tick = async () => {
        if (stopped) return;
        const next = params.getText();
        if (!next || next === lastSent) return;

        console.log("tick");

        try {
            await params.editFn(next);
            lastSent = next;
        } catch (e) {
            if ((e?.description ?? e?.message ?? "").includes("message is not modified")) return;
            console.error("edit failed:", e);
        }
    };

    const timer = setInterval(async () => await tick(), params.intervalMs);

    return {
        tick,
        stop: async () => {
            stopped = true;
            clearInterval(timer);
            await tick();
            await params.onStop();
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

export type PhotoMaxSize = { width: number, height: number, url: string; unique_file_id: string; };

export async function getPhotoMaxSize(photos: PhotoSize[], target: number = Environment.MAX_PHOTO_SIZE): Promise<PhotoMaxSize | null> {
    if (!photos) return null;

    photos = photos.filter(p => Math.max(p.width, p.height) <= target);

    if (photos.length === 0) return null;

    if (photos.length === 1) {
        return mapPhotoSizeToMax(photos[0]);
    }

    const max = photos.reduce((prev, cur) => {
        if (!prev) return cur;

        return cur.width * cur.height > prev.width * prev.height ? cur : prev;
    }, null);

    if (!max) return null;
    return mapPhotoSizeToMax(max);
}

export async function mapPhotoSizeToMax(size: PhotoSize): Promise<PhotoMaxSize | null> {
    if (!size) return null;
    return {
        width: size.width,
        height: size.height,
        url: await getFileUrl(size.file_id),
        unique_file_id: size.file_unique_id
    };
}