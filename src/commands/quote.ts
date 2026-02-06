import axios from "axios";
import sharp from "sharp";
import emojiRegex from "emoji-regex";

import {createCanvas, GlobalFonts, Image, type Image as CanvasImage, loadImage, SKRSContext2D} from "@napi-rs/canvas";
import {Message, MessageEntity, PhotoSize} from "typescript-telegram-bot-api";
import {Command} from "../base/command";
import {bot, botUser} from "../index";
import {
    getChatAvatar,
    getFileUrl,
    getUserAvatar,
    logError,
    makeDarkGradientBgFancy,
    oldReplyToMessage,
    oldSendMessage
} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import twemoji from "twemoji";

try {
    GlobalFonts.registerFromPath("./assets/Inter_18pt-ExtraThin.ttf", "InterExtraThin");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Thin.ttf", "InterThin");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Light.ttf", "InterLight");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Regular.ttf", "Inter");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Medium.ttf", "InterMedium");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-SemiBold.ttf", "InterSemiBold");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Bold.ttf", "InterBold");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-ExtraBold.ttf", "InterExtraBold");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Black.ttf", "InterBlack");
    GlobalFonts.registerFromPath("./assets/Inter_18pt-Italic.ttf", "InterItalic");
    GlobalFonts.registerFromPath("./assets/JetBrainsMono-Bold.ttf", "JetBrainsMonoBold");
    GlobalFonts.registerFromPath("./assets/JetBrainsMono-Italic.ttf", "JetBrainsMonoItalic");
    GlobalFonts.registerFromPath("./assets/JetBrainsMono-Regular.ttf", "JetBrainsMonoRegular");
} catch (e) {
    logError(e);
}

export class Quote extends Command {
    command = ["cit", "citation", "q", "quote"];
    argsMode = "none" as const;

    title = "/quote";
    description = "Make quote from text (or quote)";

    requirements = Requirements.Build(Requirement.REPLY);

    async execute(msg: Message): Promise<void> {
        const chatId = msg.chat.id;
        const reply = msg.reply_to_message;

        if (!reply) {
            await oldReplyToMessage(msg, "Сделай /quote реплаем на сообщение 🙂").catch(logError);
            return;
        }

        try {
            const quoteRaw = (msg.quote?.text ?? reply.text ?? reply.caption ?? "").trim();
            if (quoteRaw.length === 0) {
                await oldReplyToMessage(msg, "Не нашёл в сообщении текста 😢").catch(logError);
                return;
            }

            const quote = quoteRaw.length ? quoteRaw : "…";

            const entities = msg.quote ? msg.quote.entities : reply.entities ?? reply.caption_entities ?? [];

            const png = await renderQuoteCard(msg, quote, reply, entities);
            await bot.sendPhoto({
                chat_id: chatId,
                photo: png,
                reply_parameters: {
                    message_id: msg.message_id,
                },
            }).catch(logError);
        } catch (e) {
            logError(e);
            await oldSendMessage(msg, "Не смог собрать цитату 😢").catch(logError);
        }
    }
}

const emojiCache = new Map<string, CanvasImage>();
const customEmojiCache = new Map<string, CanvasImage>();

function appleEmojiUrl(emoji: string): string {
    const codePoints = [...emoji]
        .map(char => char.codePointAt(0)!.toString(16))
        .join("-");
    return `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.0/img/apple/64/${codePoints}.png`;
}

function githubEmojiUrl(emoji: string): string {
    const codePoints = [...emoji]
        .map(char => char.codePointAt(0)!.toString(16))
        .join("-");
    return `https://github.githubassets.com/images/icons/emoji/unicode/${codePoints}.png`;
}

function twemojiUrl(emoji: string) {
    const code = twemoji.convert.toCodePoint(emoji);
    return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`;
}

async function loadEmoji(emoji: string): Promise<CanvasImage> {
    const downloadAndCache = async (url: string): Promise<Image> => {
        const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});
        const img = await loadImage(Buffer.from(res.data));
        emojiCache.set(url, img);
        return img;
    };

    const checkIfCached = async (emoji: string, emojiToUrl: (emoji: string) => string): Promise<CanvasImage> => {
        const url = emojiToUrl(emoji);
        const cached = emojiCache.get(url);
        if (cached) return cached;
        return await downloadAndCache(emojiToUrl(emoji));
    };

    const sources = [appleEmojiUrl, githubEmojiUrl, twemojiUrl];
    for (const source of sources) {
        try {
            return await checkIfCached(emoji, source);
        } catch (e) {
            logError(e);
        }
    }

    return null;
}

async function loadCustomEmoji(customEmojiId: string): Promise<CanvasImage | null> {
    const cached = customEmojiCache.get(customEmojiId);
    if (cached) return cached;

    try {
        const stickerSet = await bot.getCustomEmojiStickers({
            custom_emoji_ids: [customEmojiId]
        });

        if (!stickerSet || stickerSet.length === 0) {
            console.warn(`Custom emoji ${customEmojiId} not found`);
            return null;
        }

        const sticker = stickerSet[0];

        if (sticker.is_animated || sticker.is_video) {
            console.warn(`Animated/video custom emoji ${customEmojiId} not supported`);
            return loadEmoji(sticker.emoji);
        }

        const url = await getFileUrl(sticker.file_id);
        const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});

        let buffer: Buffer<ArrayBufferLike> = Buffer.from(res.data);
        try {
            buffer = await sharp(buffer).png().toBuffer();
        } catch (e) {
            logError(e);
        }

        const img = await loadImage(buffer);
        customEmojiCache.set(customEmojiId, img);
        return img;
    } catch (e) {
        console.warn(`Failed to load custom emoji ${customEmojiId}:`, e);
        return null;
    }
}

type TextStyle = {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strike?: boolean;
    underline?: boolean;
    pre?: boolean;
    mention?: boolean;
};

type Segment =
    | { type: "text"; v: string; style: TextStyle }
    | { type: "emoji"; v: string }
    | { type: "custom_emoji"; id: string };

function parseEntities(text: string, entities: MessageEntity[]): Segment[] {
    if (!entities || entities.length === 0) {
        return splitSegments(text, {});
    }

    const styleMap = new Map<number, TextStyle>();
    const customEmojiPositions = new Map<number, string>();

    for (const entity of entities) {
        const start = entity.offset;
        const end = entity.offset + entity.length;

        if (entity.type === "custom_emoji" && entity.custom_emoji_id) {
            for (let i = start; i < end; i++) {
                customEmojiPositions.set(i, entity.custom_emoji_id);
            }
            continue;
        }

        for (let i = start; i < end; i++) {
            if (!styleMap.has(i)) {
                styleMap.set(i, {});
            }
            const style = styleMap.get(i)!;

            switch (entity.type) {
                case "bold":
                    style.bold = true;
                    break;
                case "italic":
                    style.italic = true;
                    break;
                case "code":
                    style.code = true;
                    break;
                case "strikethrough":
                    style.strike = true;
                    break;
                case "underline":
                    style.underline = true;
                    break;
                case "pre":
                    style.pre = true;
                    break;
                case "mention":
                case "text_mention":
                    style.mention = true;
                    break;
            }
        }
    }

    const segments: Segment[] = [];
    const textArray = Array.from(text);
    let currentStyle: TextStyle = {};
    let currentText = "";
    let i = 0;

    const pushCurrentText = () => {
        if (currentText) {
            const textSegments = splitSegments(currentText, currentStyle);
            segments.push(...textSegments);
            currentText = "";
        }
    };

    for (const char of textArray) {
        if (char === "️") continue;
        if (customEmojiPositions.has(i)) {
            pushCurrentText();
            const emojiId = customEmojiPositions.get(i)!;
            let emojiEnd = i;
            while (emojiEnd < textArray.length * 2 && customEmojiPositions.get(emojiEnd) === emojiId) {
                emojiEnd++;
            }

            segments.push({type: "custom_emoji", id: emojiId});

            i = emojiEnd;
            continue;
        }

        const charStyle = styleMap.get(i) || {};

        const styleChanged =
            charStyle.bold !== currentStyle.bold ||
            charStyle.italic !== currentStyle.italic ||
            charStyle.code !== currentStyle.code ||
            charStyle.strike !== currentStyle.strike ||
            charStyle.underline !== currentStyle.underline ||
            charStyle.pre !== currentStyle.pre ||
            charStyle.mention !== currentStyle.mention;

        if (styleChanged && currentText) {
            pushCurrentText();
            currentStyle = charStyle;
        } else if (!currentText) {
            currentStyle = charStyle;
        }

        currentText += char;
        i++;
    }

    pushCurrentText();

    return segments;
}

function splitSegments(text: string, style: TextStyle): Segment[] {
    const re = emojiRegex();
    const out: Segment[] = [];
    let last = 0;

    for (const m of text.matchAll(re)) {
        const i = m.index ?? 0;
        if (i > last) {
            const textPart = text.slice(last, i);
            if (textPart) out.push({type: "text", v: textPart, style: {...style}});
        }
        out.push({type: "emoji", v: m[0]});
        last = i + m[0].length;
    }

    if (last < text.length) {
        const textPart = text.slice(last);
        if (textPart) out.push({type: "text", v: textPart, style: {...style}});
    }

    return out;
}

function measure(ctx: SKRSContext2D, s: string) {
    return ctx.measureText(s).width;
}

function applyTextStyle(ctx: SKRSContext2D, style: TextStyle, baseFontSize: number) {
    let fontFamily = "InterSemiBold";
    let fontStyle = "normal";

    if (style.code || style.pre) {
        if (style.bold && style.italic) {
            fontFamily = "JetBrainsMonoBold";
            fontStyle = "italic";
        } else if (style.bold) {
            fontFamily = "JetBrainsMonoBold";
        } else if (style.italic) {
            fontFamily = "JetBrainsMonoItalic";
        } else {
            fontFamily = "JetBrainsMonoRegular";
        }
    } else {
        if (style.bold && style.italic) {
            fontFamily = "InterBold";
            fontStyle = "italic";
        } else if (style.bold) {
            fontFamily = "InterBold";
        } else if (style.italic) {
            fontFamily = "InterSemiBold";
            fontStyle = "italic";
        }
    }

    ctx.font = `${fontStyle} ${baseFontSize}px ${fontFamily}, sans-serif`;
}

function wrapSegments(ctx: SKRSContext2D, segments: Segment[], maxW: number, baseFontSize: number) {
    const emojiW = Math.round(baseFontSize * 1.05);
    const lines: { segments: Segment[]; width: number }[] = [];
    let cur: Segment[] = [];
    let w = 0;

    const push = () => {
        lines.push({segments: cur, width: w});
        cur = [];
        w = 0;
    };

    const getSegmentWidth = (seg: Segment): number => {
        if (seg.type === "emoji" || seg.type === "custom_emoji") {
            return emojiW;
        }
        applyTextStyle(ctx, seg.style, baseFontSize);
        return measure(ctx, seg.v);
    };

    const add = (seg: Segment, segW: number) => {
        if (cur.length && w + segW > maxW) push();
        cur.push(seg);
        w += segW;
    };

    for (const seg of segments) {
        if (seg.type === "emoji" || seg.type === "custom_emoji") {
            add(seg, emojiW);
            continue;
        }

        const parts = seg.v.split(/(\s+)/);
        for (const p of parts) {
            if (!p) continue;

            const sub = p.split("\n");
            for (let si = 0; si < sub.length; si++) {
                const chunk = sub[si];
                if (chunk) {
                    const chunkSeg: Segment = {type: "text", v: chunk, style: seg.style};
                    add(chunkSeg, getSegmentWidth(chunkSeg));
                }
                if (si !== sub.length - 1) push();
            }
        }
    }

    if (cur.length) push();
    return lines;
}

function lineWidth(ctx: SKRSContext2D, segments: Segment[], fontSize: number) {
    const emojiSize = Math.round(fontSize * 1.05);
    let w = 0;
    for (const s of segments) {
        if (s.type === "emoji" || s.type === "custom_emoji") {
            w += emojiSize;
        } else {
            applyTextStyle(ctx, s.style, fontSize);
            w += ctx.measureText(s.v).width;
        }
    }
    return w;
}

function addEllipsisToFit(ctx: SKRSContext2D, segments: Segment[], maxW: number, fontSize: number): Segment[] {
    const emojiSize = Math.round(fontSize * 1.05);
    const ell: Segment = {type: "text", v: "…", style: {}};

    ctx.font = `${fontSize}px InterSemiBold, sans-serif`;
    const ellW = ctx.measureText("…").width;

    const out = segments.map((s) => ({...s})) as Segment[];

    const widthOf = (arr: Segment[]) => {
        let w = 0;
        for (const s of arr) {
            if (s.type === "emoji" || s.type === "custom_emoji") {
                w += emojiSize;
            } else {
                applyTextStyle(ctx, s.style, fontSize);
                w += ctx.measureText(s.v).width;
            }
        }
        return w;
    };

    while (out.length && widthOf(out) + ellW > maxW) {
        const last = out[out.length - 1];
        if (last.type === "emoji" || last.type === "custom_emoji") {
            out.pop();
            continue;
        }
        if (last.v.length <= 1) {
            out.pop();
            continue;
        }
        last.v = last.v.slice(0, -1);
    }

    return [...out, ell];
}

async function drawLine(ctx: SKRSContext2D, line: Segment[], x: number, baselineY: number, fontSize: number) {
    const emojiSize = Math.round(fontSize * 1.05);
    let cx = x;

    for (const seg of line) {
        if (seg.type === "text") {
            applyTextStyle(ctx, seg.style, fontSize);

            if (seg.style.underline || seg.style.strike) {
                const textWidth = measure(ctx, seg.v);
                const oldStroke = ctx.strokeStyle;
                const oldLineWidth = ctx.lineWidth;

                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = Math.max(1, fontSize / 20);

                if (seg.style.underline) {
                    const underlineY = baselineY + fontSize * 0.1;
                    ctx.beginPath();
                    ctx.moveTo(cx, underlineY);
                    ctx.lineTo(cx + textWidth, underlineY);
                    ctx.stroke();
                }

                if (seg.style.strike) {
                    const strikeY = baselineY - fontSize * 0.3;
                    ctx.beginPath();
                    ctx.moveTo(cx, strikeY);
                    ctx.lineTo(cx + textWidth, strikeY);
                    ctx.stroke();
                }

                ctx.strokeStyle = oldStroke;
                ctx.lineWidth = oldLineWidth;
            }

            ctx.fillText(seg.v, cx, baselineY);
            cx += measure(ctx, seg.v);
        } else if (seg.type === "emoji") {
            try {
                const img = await loadEmoji(seg.v);
                const y = baselineY - emojiSize + Math.round(fontSize * 0.2);
                ctx.drawImage(img, cx, y, emojiSize, emojiSize);
            } catch (e) {
                logError(e);
                ctx.fillText(seg.v, cx, baselineY);
            }
            cx += emojiSize;
        } else if (seg.type === "custom_emoji") {
            try {
                const img = await loadCustomEmoji(seg.id);
                if (img) {
                    const y = baselineY - emojiSize + Math.round(fontSize * 0.2);
                    ctx.drawImage(img, cx, y, emojiSize, emojiSize);
                } else {
                    const img = await loadEmoji("😥");
                    const y = baselineY - emojiSize + Math.round(fontSize * 0.2);
                    ctx.drawImage(img, cx, y, emojiSize, emojiSize);
                }
            } catch (e) {
                console.warn("Failed to draw custom emoji:", e);

                try {
                    const img = await loadEmoji("😥");
                    const y = baselineY - emojiSize + Math.round(fontSize * 0.2);
                    ctx.drawImage(img, cx, y, emojiSize, emojiSize);
                } catch (e) {
                    logError(e);

                    ctx.fillText(":-(", cx, baselineY);
                }
            }

            cx += emojiSize;
        }
    }
}

type Fitted = {
    fontSize: number;
    lineH: number;
    lines: { segments: Segment[]; width: number }[];
    truncated: boolean;
};

function fitQuoteToBox(ctx: SKRSContext2D, segments: Segment[], boxW: number, boxH: number): Fitted {
    const MAX_FONT = 64;
    const MIN_FONT = 12;
    const endSuffix = " »";

    for (let fontSize = MAX_FONT; fontSize >= MIN_FONT; fontSize -= 1) {
        ctx.font = `${fontSize}px InterSemiBold, sans-serif`;

        const lines = wrapSegments(ctx, segments, boxW, fontSize);
        const lineH = Math.round(fontSize * 1.20);
        const totalH = lines.length * lineH;

        if (!lines.length) continue;

        const endW = ctx.measureText(endSuffix).width;
        const last = lines[lines.length - 1];

        if (totalH <= boxH && last.width + endW <= boxW) {
            last.segments = [...last.segments, {type: "text", v: endSuffix, style: {}}];
            last.width += endW;

            return {fontSize: fontSize, lineH, lines, truncated: false};
        }
    }

    const fontSize = MIN_FONT;
    ctx.font = `${fontSize}px InterSemiBold, sans-serif`;

    const lineH = Math.round(fontSize * 1.20);
    const maxLinesByHeight = Math.max(1, Math.floor(boxH / lineH));

    let lines = wrapSegments(ctx, segments, boxW, fontSize);

    const endW = ctx.measureText(endSuffix).width;

    if (lines.length > maxLinesByHeight) {
        lines = lines.slice(0, maxLinesByHeight);
        const last = lines[lines.length - 1];

        if (last.width + endW > boxW) {
            last.segments = addEllipsisToFit(ctx, last.segments, boxW - endW, fontSize);
            last.width = lineWidth(ctx, last.segments, fontSize);
        } else {
            last.segments = addEllipsisToFit(ctx, last.segments, boxW - endW, fontSize);
            last.width = lineWidth(ctx, last.segments, fontSize);
        }
    } else {
        const last = lines[lines.length - 1];
        if (last && last.width + endW > boxW) {
            last.segments = addEllipsisToFit(ctx, last.segments, boxW - endW, fontSize);
            last.width = lineWidth(ctx, last.segments, fontSize);
        }
    }

    if (lines.length) {
        const last = lines[lines.length - 1];
        last.segments = [...last.segments, {type: "text", v: endSuffix, style: {}}];
        last.width += endW;
    }

    return {fontSize: fontSize, lineH, lines, truncated: true};
}

async function getBackground(
    msg: Message,
    reply: Message,
    W: number,
    H: number,
    author: QuoteAuthor,
    isForwarded: boolean
): Promise<Buffer> {
    let src: Buffer | null = null;

    const photoArr = (msg.photo || reply.photo) as PhotoSize[] | undefined;
    const msgPhoto = photoArr && photoArr.length ? photoArr[photoArr.length - 1] : undefined;

    if (msgPhoto?.file_id) {
        const url = await getFileUrl(msgPhoto.file_id);
        const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});
        src = Buffer.from(res.data);
    } else {
        if (author.userId) {
            src = await getUserAvatar(author.userId);
        } else if (author.chatId) {
            src = await getChatAvatar(author.chatId);
        } else if (!isForwarded && reply.from?.id) {
            src = await getUserAvatar(reply.from.id);
        }
    }

    if (!src) {
        return makeDarkGradientBgFancy(W, H, `${reply.message_id}-${reply.date ?? ""}`);
    }

    return sharp(src)
        .resize(W, H, {fit: "cover"})
        .blur(18)
        .modulate({brightness: 0.75, saturation: 1.1})
        .png()
        .toBuffer();
}

async function renderQuoteCard(msg: Message, quote: string, reply: Message, entities: MessageEntity[]) {
    const W = 1280;
    const H = 720;

    const author = getQuoteAuthor(reply);
    const forwarded = !!reply.forward_origin;
    const name = author.name;
    const userTag = author.username ? `@${author.username}` : "";

    const me = botUser;
    const botTag = me.username ? `@${me.username}` : "@bot";

    const date = new Date((reply.date ?? Math.floor(Date.now() / 1000)) * 1000);
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    const dateStr = `${dd}.${mm}.${yyyy}`;

    const bgBuf = await getBackground(msg, reply, W, H, author, forwarded);

    const canvas = createCanvas(W, H);
    const c = canvas.getContext("2d");

    const bgImg = await loadImage(bgBuf);
    c.drawImage(bgImg, 0, 0, W, H);

    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fillRect(0, 0, W, H);

    const edgePad = 56;
    const reservedBottom = 140;

    const quoteBoxX = edgePad;
    const quoteBoxW = W - edgePad * 2;

    const quoteTop = 90;
    const quoteBottom = H - reservedBottom;
    const quoteH = quoteBottom - quoteTop;

    c.fillStyle = "rgba(255,255,255,0.92)";
    c.textBaseline = "alphabetic";
    c.shadowColor = "rgba(0,0,0,0.55)";
    c.shadowBlur = 10;
    c.shadowOffsetY = 2;

    const segments = parseEntities(quote, entities);

    const quoteSegments: Segment[] = [
        {type: "text", v: "« ", style: {}},
        ...segments
    ];

    const fitted = fitQuoteToBox(c, quoteSegments, quoteBoxW, quoteH);

    const totalTextH = fitted.lines.length * fitted.lineH;
    let y = quoteTop + (quoteH - totalTextH) / 2 + fitted.fontSize;

    for (const ln of fitted.lines) {
        const x = quoteBoxX + (quoteBoxW - ln.width) / 2;
        await drawLine(c, ln.segments, x, y, fitted.fontSize);
        y += fitted.lineH;
    }

    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.fillStyle = "rgba(255,255,255,0.70)";
    c.font = "28px InterLight, Inter, sans-serif";
    c.textAlign = "center";
    c.fillText(userTag ? `${name} | ${userTag}` : name, W / 2, H - 86);

    c.font = "22px InterMedium, sans-serif";
    c.fillStyle = "rgba(255,255,255,0.45)";
    c.textAlign = "left";
    c.fillText(botTag, edgePad, H - 34);
    c.textAlign = "right";
    c.fillText(dateStr, W - edgePad, H - 34);

    return canvas.toBuffer("image/png");
}

type QuoteAuthor = {
    name: string;
    username?: string;
    userId?: number;
    chatId?: number;
};

function getQuoteAuthor(reply: Message): QuoteAuthor {
    const origin = reply.forward_origin;
    if (origin) {
        switch (origin.type) {
            case "user": {
                const u = origin.sender_user;
                const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Unknown";
                return {name, username: u.username, userId: u.id};
            }
            case "hidden_user": {
                const name = origin.sender_user_name || "Unknown";
                return {name};
            }
        }
    }

    const u = reply.from!;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Unknown";
    return {name, username: u.username, userId: u.id};
}