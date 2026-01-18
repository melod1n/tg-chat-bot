import {ChatCommand} from "../base/chat-command";
import {Message} from "typescript-telegram-bot-api";
import {logError, replyToMessage} from "../util/utils";

const EN =
    "`qwertyuiop[]asdfghjkl;'zxcvbnm,./" +
    "~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?" +
    "1234567890-=" +
    "!@#$%^&*()_+";

const RU =
    "ёйцукенгшщзхъфывапролджэячсмитьбю." +
    "ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ," +
    "1234567890-=" +
    "!\"№;%:?*()_+";

function makeMap(from: string, to: string): Map<string, string> {
    if (from.length !== to.length) {
        throw new Error(`Layout maps must be same length: ${from.length} vs ${to.length}`);
    }
    const m = new Map<string, string>();
    for (let i = 0; i < from.length; i++) m.set(from[i], to[i]);
    return m;
}

const enToRu = makeMap(EN, RU);
const ruToEn = makeMap(RU, EN);

function swapLayout(text: string, map: Map<string, string>): string {
    let out = "";
    for (const ch of text) out += map.get(ch) ?? ch;
    return out;
}

export const toRuLayout = (text: string) => swapLayout(text, enToRu);
export const toEnLayout = (text: string) => swapLayout(text, ruToEn);

const reCyr = /\p{Script=Cyrillic}/u;
const reLat = /\p{Script=Latin}/u;

export type ScriptGuess = "ru" | "en" | "mixed" | "unknown";

export function detectScript(text: string): ScriptGuess {
    let cyr = 0, lat = 0;

    for (const ch of text) {
        if (reCyr.test(ch)) cyr++;
        else if (reLat.test(ch)) lat++;
    }

    if (cyr === 0 && lat === 0) return "unknown";
    if (cyr > 0 && lat > 0) return "mixed";
    return cyr > 0 ? "ru" : "en";
}

const EN_VOWELS = /[aeiouy]/i;
const RU_VOWELS = /[аеёиоуыэюя]/i;

function vowelRatio(text: string, reLetter: RegExp, reVowel: RegExp): number {
    let letters = 0, vowels = 0;
    for (const ch of text) {
        if (reLetter.test(ch)) {
            letters++;
            if (reVowel.test(ch)) vowels++;
        }
    }
    return letters === 0 ? 0 : vowels / letters;
}

function looksLikeEnglish(text: string): boolean {
    const ratio = vowelRatio(text, /\p{Script=Latin}/u, EN_VOWELS);
    return ratio >= 0.20;
}

function looksLikeRussian(text: string): boolean {
    const ratio = vowelRatio(text, /\p{Script=Cyrillic}/u, RU_VOWELS);
    return ratio >= 0.18;
}

export function fixLayoutAuto(
    text: string,
    toRuLayout: (s: string) => string,
    toEnLayout: (s: string) => string,
): string {
    const guess = detectScript(text);

    if (guess === "en") {
        if (looksLikeEnglish(text)) return text;
        return toRuLayout(text);
    }

    if (guess === "ru") {
        if (looksLikeRussian(text)) return text;
        return toEnLayout(text);
    }

    return text;
}

export class Transliteration extends ChatCommand {
    regexp = /^\/tr/i;
    title = "/tr [text or reply]";
    description = "Transliteration EN <--> RU";

    async execute(msg: Message): Promise<void> {
        let text: string = "";

        if (msg.reply_to_message) {
            text = (msg.reply_to_message.text || msg.reply_to_message.caption || "");
        } else {
            const split = (msg.text || msg.caption).split("/tr ");
            if (split.length > 1) {
                text = split[1].trim();
            }
        }

        if (text.length === 0) {
            return;
        }

        const newText = fixLayoutAuto(text, toRuLayout, toEnLayout);

        await replyToMessage(msg, newText).catch(logError);
    }
}