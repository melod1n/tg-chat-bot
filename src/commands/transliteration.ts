import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {logError, oldReplyToMessage, randomValue} from "../util/utils";

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
    if (cyr === lat) return "mixed";
    return cyr > lat ? "ru" : "en";
}

export function fixLayoutAuto(
    text: string,
    toRuLayout: (s: string) => string,
    toEnLayout: (s: string) => string,
): string {
    let guess = detectScript(text);
    if (guess === "mixed") {
        guess = randomValue([true, false]) ? "ru" : "en";
    }

    if (guess === "en") {
        return toRuLayout(text);
    }

    if (guess === "ru") {
        return toEnLayout(text);
    }

    return text;
}

export class Transliteration extends Command {
    command = ["transliteration", "tr"];

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

        await oldReplyToMessage(msg, newText).catch(logError);
    }
}