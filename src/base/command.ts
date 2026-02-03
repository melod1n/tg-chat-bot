import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "./requirements";

export type ArgsMode = "none" | "optional" | "required";

export abstract class Command {

    regexp?: RegExp | null;
    command?: string | string[];
    argsMode: ArgsMode = "none";

    requirements?: Requirements = null;
    title?: string;
    description?: string;

    get finalRegexp(): RegExp {
        if (!this.regexp) {
            const inferred = name(this.constructor.name);
            const names = this.command ?? inferred;
            this.regexp = createCommandRegExp(names, this.argsMode);
        }
        return this.regexp;
    }

    abstract execute(
        msg: Message,
        match?: RegExpExecArray
    ): Promise<void>;
}

export function name(s: string) {
    return s
        .replace(/Command$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1$2")
        .toLowerCase();
}

function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createCommandRegExp(
    names: string | string[],
    argsMode: ArgsMode = "optional",
) {
    const list = Array.isArray(names) ? names : [names];
    const group = list.map(escapeRe).join("|");

    const base = `^\\/(${group})(?:@([\\w_]+))?`; // (1)=cmd, (2)=bot
    const tail =
        argsMode === "none"
            ? "\\s*$"
            : argsMode === "required"
                ? "\\s+([\\s\\S]+)\\s*$"          // (3)=args обязателен
                : "(?:\\s+([\\s\\S]+))?\\s*$";   // (3)=args опционален

    return new RegExp(base + tail, "i");
}
