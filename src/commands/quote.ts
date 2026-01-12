import axios from "axios";
import sharp from "sharp";
import twemoji from "twemoji";
import emojiRegex from "emoji-regex";

import {createCanvas, GlobalFonts, type Image as CanvasImage, loadImage, SKRSContext2D} from "@napi-rs/canvas";
import {Message, PhotoSize} from "typescript-telegram-bot-api";
import {ChatCommand} from "../base/chat-command";
import {bot, botUser} from "../index";
import {
    getChatAvatar,
    getFileUrl,
    getUserAvatar,
    logError,
    makeDarkGradientBgFancy,
    oldSendMessage,
    replyToMessage
} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";

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
} catch (e) {
    console.error(e);
}

export class Quote extends ChatCommand {
    regexp = /^\/(cit|q|quote)$/i;
    title = "/quote";
    description = "Make quote from text (or quote)";

    requirements = Requirements.Build(Requirement.REPLY);

    async execute(msg: Message): Promise<void> {
        const chatId = msg.chat.id;
        const reply = msg.reply_to_message;

        if (!reply) {
            await replyToMessage(msg, "Сделай /quote реплаем на сообщение 🙂").catch(logError);
            return;
        }

        try {
            const quoteRaw = (msg.quote?.text ?? reply.text ?? reply.caption ?? "").trim();
            if (quoteRaw.length === 0) {
                await replyToMessage(msg, "Не нашёл в сообщении текста 😢").catch(logError);
                return;
            }

            let quote = quoteRaw.length ? quoteRaw : "…";
            if (quote.length > 2500) quote = quote.slice(0, 2497) + "…";

            const png = await renderQuoteCard(quote, reply);
            await bot.sendPhoto({
                chat_id: chatId,
                photo: png,
                reply_parameters: {
                    message_id: msg.message_id,
                },
            }).catch(logError);
        } catch (e) {
            console.error(e);
            await oldSendMessage(msg, "Не смог собрать цитату 😢").catch(logError);
        }
    }
}

// ===== Emoji cache & helpers =====

const emojiCache = new Map<string, CanvasImage>();

function twemojiUrl(emoji: string) {
    const code = twemoji.convert.toCodePoint(emoji);
    return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`;
}

async function loadEmoji(emoji: string): Promise<CanvasImage> {
    const url = twemojiUrl(emoji);
    const cached = emojiCache.get(url);
    if (cached) return cached;

    const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});
    const img = await loadImage(Buffer.from(res.data));
    emojiCache.set(url, img);
    return img;
}

type Segment = { type: "text"; v: string } | { type: "emoji"; v: string };

function splitSegments(text: string): Segment[] {
    const re = emojiRegex();
    const out: Segment[] = [];
    let last = 0;

    for (const m of text.matchAll(re)) {
        const i = m.index ?? 0;
        if (i > last) out.push({type: "text", v: text.slice(last, i)});
        out.push({type: "emoji", v: m[0]});
        last = i + m[0].length;
    }
    if (last < text.length) out.push({type: "text", v: text.slice(last)});
    return out;
}

function measure(ctx: SKRSContext2D, s: string) {
    return ctx.measureText(s).width;
}

function wrapSegments(ctx: SKRSContext2D, segments: Segment[], maxW: number, emojiW: number) {
    const lines: { segments: Segment[]; width: number }[] = [];
    let cur: Segment[] = [];
    let w = 0;

    const push = () => {
        lines.push({segments: cur, width: w});
        cur = [];
        w = 0;
    };

    const add = (seg: Segment, segW: number) => {
        if (cur.length && w + segW > maxW) push();
        cur.push(seg);
        w += segW;
    };

    for (const seg of segments) {
        if (seg.type === "emoji") {
            add(seg, emojiW);
            continue;
        }

        // переносы/пробелы
        const parts = seg.v.split(/(\s+)/);
        for (const p of parts) {
            if (!p) continue;

            const sub = p.split("\n");
            for (let si = 0; si < sub.length; si++) {
                const chunk = sub[si];
                if (chunk) add({type: "text", v: chunk}, measure(ctx, chunk));
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
        w += s.type === "emoji" ? emojiSize : ctx.measureText(s.v).width;
    }
    return w;
}

function addEllipsisToFit(ctx: SKRSContext2D, segments: Segment[], maxW: number, fontSize: number): Segment[] {
    const emojiSize = Math.round(fontSize * 1.05);
    const ell: Segment = {type: "text", v: "…"};
    const ellW = ctx.measureText("…").width;

    const out = segments.map((s) => ({...s})) as Segment[];

    const widthOf = (arr: Segment[]) => {
        let w = 0;
        for (const s of arr) w += s.type === "emoji" ? emojiSize : ctx.measureText(s.v).width;
        return w;
    };

    while (out.length && widthOf(out) + ellW > maxW) {
        const last = out[out.length - 1];
        if (last.type === "emoji") {
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
            ctx.fillText(seg.v, cx, baselineY);
            cx += measure(ctx, seg.v);
        } else {
            const img = await loadEmoji(seg.v);
            const y = baselineY - emojiSize + Math.round(fontSize * 0.2);
            ctx.drawImage(img, cx, y, emojiSize, emojiSize);
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

function fitQuoteToBox(ctx: SKRSContext2D, quoteWithOpen: string, boxW: number, boxH: number): Fitted {
    const MAX_FONT = 64;
    const MIN_FONT = 18;
    const endSuffix = " »";

    const segments = splitSegments(quoteWithOpen);

    for (let fontSize = MAX_FONT; fontSize >= MIN_FONT; fontSize -= 2) {
        const emojiSize = Math.round(fontSize * 1.05);
        ctx.font = `${fontSize}px Inter, sans-serif`;

        const lines = wrapSegments(ctx, segments, boxW, emojiSize);
        const lineH = Math.round(fontSize * 1.20);
        const totalH = lines.length * lineH;

        if (!lines.length) continue;

        const endW = ctx.measureText(endSuffix).width;
        const last = lines[lines.length - 1];

        if (totalH <= boxH && last.width + endW <= boxW) {
            last.segments = [...last.segments, {type: "text", v: endSuffix}];
            last.width += endW;

            return {fontSize: fontSize, lineH, lines, truncated: false};
        }
    }

    const fontSize = MIN_FONT;
    const emojiSize = Math.round(fontSize * 1.05);
    ctx.font = `${fontSize}px Inter, sans-serif`;

    const lineH = Math.round(fontSize * 1.20);
    const maxLinesByHeight = Math.max(1, Math.floor(boxH / lineH));

    let lines = wrapSegments(ctx, segments, boxW, emojiSize);

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
        last.segments = [...last.segments, {type: "text", v: endSuffix}];
        last.width += endW;
    }

    return {fontSize: fontSize, lineH, lines, truncated: true};
}

async function getBackground(
    reply: Message,
    W: number,
    H: number,
    author: QuoteAuthor,
    isForwarded: boolean
): Promise<Buffer> {
    let src: Buffer | null = null;

    const photoArr = reply.photo as PhotoSize[] | undefined;
    const msgPhoto = photoArr && photoArr.length ? photoArr[photoArr.length - 1] : undefined;

    if (msgPhoto?.file_id) {
        const url = await getFileUrl(bot, msgPhoto.file_id);
        const res = await axios.get<ArrayBuffer>(url, {responseType: "arraybuffer"});
        src = Buffer.from(res.data);
    } else {
        if (author.userId) {
            src = await getUserAvatar(bot, author.userId);
        } else if (author.chatId) {
            src = await getChatAvatar(bot, author.chatId);
        } else if (!isForwarded && reply.from?.id) {
            src = await getUserAvatar(bot, reply.from.id);
        }
    }

    if (!src) {
        return makeDarkGradientBgFancy(W, H, `${reply.message_id}-${reply.date ?? ""}`);
        // return sharp({create: {width: W, height: H, channels: 3, background: "#1f1f1f"}})
        //     .png()
        //     .toBuffer();
    }

    return sharp(src)
        .resize(W, H, {fit: "cover"})
        .blur(18)
        .modulate({brightness: 0.75, saturation: 1.1})
        .png()
        .toBuffer();
}

async function renderQuoteCard(quote: string, reply: Message) {
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

    const bgBuf = await getBackground(reply, W, H, author, forwarded);

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

    const quoteForFit = `« ${quote}`;
    const fitted = fitQuoteToBox(c, quoteForFit, quoteBoxW, quoteH);

    c.font = `${fitted.fontSize}px InterSemiBold, sans-serif`;

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
