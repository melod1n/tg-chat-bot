import {AiTool} from "../tool-types";
import {asNonEmptyString} from "./utils.js";
import {AiJsonObject} from "../tool-types";

export const getCurrentDateTimeTool = {
    type: "function",
    function: {
        name: "get_datetime",
        description:
            "Get the real current date and time. Use this tool before answering any request that depends on today, now, current time, current date, weekday, timestamp, timezone conversion, or relative dates like yesterday, tomorrow, next week, or 3 days ago.",
        parameters: {
            type: "object",
            properties: {
                timeZone: {
                    type: "string",
                    description:
                        "Optional IANA timezone, for example Europe/Moscow, Europe/Berlin, UTC. If omitted, system timezone is used.",
                },
                locale: {
                    type: "string",
                    description:
                        "Optional locale, for example ru-RU or en-US. If omitted, system locale/default locale is used.",
                },
            },
            required: [],
        },
    },
} satisfies AiTool;

export const dateTimeToolPrompt = [
    "Datetime tool rules:",
    "- Use `get_datetime` whenever the answer depends on the real current date/time.",
    "- Never guess the current date/time. Call the tool first.",
    "",
    "Arguments:",
    "- `timeZone`: optional IANA timezone, e.g. `Europe/Moscow`, `Europe/Berlin`, `UTC`.",
    "- `locale`: optional locale, e.g. `ru-RU`, `en-US`.",
    "",
    "After the tool returns:",
    "- Base the answer on the returned value.",
    "- Do not expose raw tool JSON unless asked.",
].join("\n");

function getSystemTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getCurrentDateTime(args?: AiJsonObject) {
    const now = new Date();

    const systemTimeZone = getSystemTimeZone();
    const requestedTimeZone = asNonEmptyString(args?.timeZone);
    const requestedLocale = asNonEmptyString(args?.locale);

    const timeZone = requestedTimeZone ?? systemTimeZone;
    const locale = requestedLocale ?? undefined;

    try {
        const formatted = new Intl.DateTimeFormat(locale, {
            timeZone,
            dateStyle: "full",
            timeStyle: "long",
        }).format(now);

        return {
            iso: now.toISOString(),
            unixMs: now.getTime(),
            timeZone,
            systemTimeZone,
            locale: locale ?? "system-default",
            formatted,
        };
    } catch (error) {
        const formatted = new Intl.DateTimeFormat(undefined, {
            timeZone: systemTimeZone,
            dateStyle: "full",
            timeStyle: "long",
        }).format(now);

        return {
            iso: now.toISOString(),
            unixMs: now.getTime(),
            timeZone: systemTimeZone,
            systemTimeZone,
            locale: "system-default",
            formatted,
            warning: "Invalid locale or timezone was provided. Fallback to system locale and system timezone was used.",
            requestedTimeZone: requestedTimeZone ?? null,
            requestedLocale: requestedLocale ?? null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
