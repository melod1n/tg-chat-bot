import axios from "axios";
import {toolsLogger} from "./tool-logger.js";

const logger = toolsLogger.child("brave-search");
import {Environment} from "../../common/environment.js";
import {logError} from "../../util/utils.js";
import {AiJsonObject, AiJsonValue, AiTool} from "../tool-types.js";
import {asBoolean, asNonEmptyString} from "./utils.js";

type BraveSearchProfile = {
    name?: string;
    long_name?: string;
    url?: string;
    img?: string;
};

type BraveSearchMetaUrl = {
    scheme?: string;
    netloc?: string;
    hostname?: string;
    favicon?: string;
    path?: string;
};

type BraveSearchThumbnail = {
    src?: string;
    original?: string;
};

type BraveSearchResult = {
    type?: string;
    title?: string;
    url?: string;
    description?: string;
    age?: string;
    page_age?: string;
    language?: string;
    family_friendly?: boolean;
    is_source_local?: boolean;
    is_source_both?: boolean;
    profile?: BraveSearchProfile;
    meta_url?: BraveSearchMetaUrl;
    thumbnail?: BraveSearchThumbnail;
    extra_snippets?: string[];
};

type BraveSearchApiResponse = {
    type?: string;
    query?: {
        original?: string;
        show_strict_warning?: boolean;
        is_navigational?: boolean;
        is_news_breaking?: boolean;
        spellcheck_off?: boolean;
        country?: string;
        bad_results?: boolean;
        should_fallback?: boolean;
        postal_code?: string;
        city?: string;
        header_country?: string;
        more_results_available?: boolean;
        state?: string;
        altered?: string;
    };

    web?: {
        type?: string;
        results?: BraveSearchResult[];
    };

    news?: {
        type?: string;
        results?: BraveSearchResult[];
    };

    videos?: {
        type?: string;
        results?: BraveSearchResult[];
    };

    discussions?: {
        type?: string;
        results?: BraveSearchResult[];
    };

    faq?: AiJsonValue;
    infobox?: AiJsonValue;
    locations?: AiJsonValue;
    mixed?: AiJsonValue;
    summarizer?: AiJsonValue;
};

export const WEB_SEARCH_TOOL_NAME = "web_search";

export const webSearchTool = {
    type: "function",
    function: {
        name: WEB_SEARCH_TOOL_NAME,
        description:
            "Search the web using Brave Search API. Use this for current information, facts, documentation, news, products, recent events, source lookup, and general web search. Returns ranked web/news/video results with titles, URLs and snippets.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Search query. Must be non-empty. Maximum 400 characters and 50 words.",
                },
                count: {
                    type: "number",
                    description:
                        "Number of web results to return. Min 1, max 20. Default is 5.",
                },
                offset: {
                    type: "number",
                    description:
                        "Zero-based page offset. Min 0, max 9. Default is 0.",
                },
                country: {
                    type: "string",
                    description:
                        "Optional 2-letter country code for result localization, for example US, RU, DE. Default is US.",
                },
                searchLang: {
                    type: "string",
                    description:
                        "Optional search language code, for example en, ru, de. Default is en.",
                },
                uiLang: {
                    type: "string",
                    description:
                        "Optional UI language, usually language-country format, for example en-US, ru-RU, de-DE.",
                },
                safesearch: {
                    type: "string",
                    enum: ["off", "moderate", "strict"],
                    description:
                        "Adult content filter. Default is moderate.",
                },
                freshness: {
                    type: "string",
                    description:
                        "Optional freshness filter: pd for last 24h, pw for last 7 days, pm for last 31 days, py for last 365 days, or YYYY-MM-DDtoYYYY-MM-DD.",
                },
                resultFilter: {
                    type: "string",
                    description:
                        "Comma-separated result types. Examples: web, news, videos, discussions, faq, infobox, locations, query, summarizer. Default is web.",
                },
                extraSnippets: {
                    type: "boolean",
                    description:
                        "Whether to request extra snippets. Default is false.",
                },
                spellcheck: {
                    type: "boolean",
                    description:
                        "Whether Brave may spellcheck and alter the query. Default is true.",
                },
            },
            required: ["query"],
        },
    },
} satisfies AiTool;

export const webSearchToolPrompt = [
    "Brave Search tool rules:",
    "- You have access to `web_search`.",
    "- Use `web_search` when the user asks for current information, recent events, fresh prices, documentation lookup, source lookup, product info, news, public facts, or anything that may have changed.",
    "- Use `web_search` for normal web search results.",
    "- Do not use `shell_execute` for web search.",
    "",
    "How to query:",
    "- Keep search queries short and focused.",
    "- Prefer the user's original language unless another language is clearly better for the topic.",
    "- Use `searchLang` based on the expected language of results: `ru` for Russian, `en` for English, `de` for German.",
    "- Use `country` for localization when relevant, for example `RU`, `US`, `DE`.",
    "- Use `count` between 3 and 10 by default.",
    "- Use `resultFilter: \"web\"` for normal search.",
    "- Use `resultFilter: \"news,web\"` for recent news/events.",
    "- Use `resultFilter: \"videos\"` only when the user asks for videos.",
    "- Use `resultFilter: \"discussions,web\"` when forum/community opinions are useful.",
    "",
    "Freshness:",
    "- Use `freshness: \"pd\"` for last 24 hours.",
    "- Use `freshness: \"pw\"` for last 7 days.",
    "- Use `freshness: \"pm\"` for last 31 days.",
    "- Use `freshness: \"py\"` for last 365 days.",
    "- Use a custom range like `2025-01-01to2025-12-31` only when the user asks for a specific date range.",
    "",
    "Answering:",
    "- Treat snippets as hints, not as full source documents.",
    "- Do not invent details that are not present in the search results.",
    "- When giving factual claims based on search results, mention the source title or URL.",
    "- If results are weak, ambiguous or empty, say that the search result was insufficient.",
    "",
].join("\n");

function asIntegerInRange(
    value: AiJsonValue | undefined,
    fallback: number,
    min: number,
    max: number,
): number {
    const parsed = typeof value === "number"
        ? value
        : typeof value === "string"
            ? Number(value)
            : NaN;

    if (!Number.isFinite(parsed)) return fallback;

    const int = Math.trunc(parsed);

    return Math.min(max, Math.max(min, int));
}

function asEnum<T extends string>(
    value: AiJsonValue | undefined,
    allowed: readonly T[],
    fallback: T,
): T {
    if (typeof value !== "string") return fallback;

    const normalized = value.trim();

    return allowed.includes(normalized as T)
        ? normalized as T
        : fallback;
}

function cleanSearchText(value: AiJsonValue | undefined): string | null {
    if (typeof value !== "string") return null;

    return value
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim() || null;
}

function normalizeBraveResultFilter(value: AiJsonValue | undefined): string {
    const allowed = new Set([
        "discussions",
        "faq",
        "infobox",
        "news",
        "query",
        "summarizer",
        "videos",
        "web",
        "locations",
    ]);

    const raw = asNonEmptyString(value);

    if (!raw) return "web";

    const parts = raw
        .split(",")
        .map(part => part.trim().toLowerCase())
        .filter(part => allowed.has(part));

    return parts.length ? [...new Set(parts)].join(",") : "web";
}

export async function webSearch(args?: AiJsonObject) {
    const startedAt = Date.now();
    logger.info("start", {args});

    try {
        const query = asNonEmptyString(args?.query);

        if (!query) {
            throw new Error("query is required");
        }

        if (query.length > 400) {
            throw new Error("query is too long. Max allowed length is 400 characters.");
        }

        const wordCount = query.split(/\s+/).filter(Boolean).length;

        if (wordCount > 50) {
            throw new Error("query has too many words. Max allowed word count is 50.");
        }

        const count = asIntegerInRange(args?.count, 5, 1, 20);
        const offset = asIntegerInRange(args?.offset, 0, 0, 9);

        const country = asNonEmptyString(args?.country)?.toUpperCase() ?? "US";
        const searchLang = asNonEmptyString(args?.searchLang)?.toLowerCase() ?? "en";
        const uiLang = asNonEmptyString(args?.uiLang) ?? undefined;

        const safesearch = asEnum(
            args?.safesearch,
            ["off", "moderate", "strict"] as const,
            "moderate",
        );

        const freshness = asNonEmptyString(args?.freshness);
        const resultFilter = normalizeBraveResultFilter(args?.resultFilter);

        const extraSnippets = asBoolean(args?.extraSnippets, false);
        const spellcheck = asBoolean(args?.spellcheck, true);

        const response = await axios.get<BraveSearchApiResponse>(
            "https://api.search.brave.com/res/v1/web/search",
            {
                timeout: 10_000,
                params: {
                    q: query,
                    count,
                    offset,
                    country,
                    search_lang: searchLang,
                    safesearch,
                    result_filter: resultFilter,
                    text_decorations: false,
                    spellcheck,
                    extra_snippets: extraSnippets,
                    ...(uiLang ? {ui_lang: uiLang} : {}),
                    ...(freshness ? {freshness} : {}),
                },
                headers: {
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": Environment.BRAVE_SEARCH_API_KEY,
                    "User-Agent": "TelegramBot/1.0",
                },
            },
        );

        const data = response.data;

        return {
            ok: true,
            query,
            alteredQuery: data.query?.altered ?? null,
            moreResultsAvailable: data.query?.more_results_available ?? null,
            resultFilter,
            count,
            offset,
            country,
            searchLang,
            safesearch,
            freshness: freshness ?? null,

            web: data.web?.results?.map(mapBraveResult) ?? [],
            news: data.news?.results?.map(mapBraveResult) ?? [],
            videos: data.videos?.results?.map(mapBraveResult) ?? [],
            discussions: data.discussions?.results?.map(mapBraveResult) ?? [],

            hasInfobox: Boolean(data.infobox),
            hasFaq: Boolean(data.faq),
            hasLocations: Boolean(data.locations),
            hasSummarizer: Boolean(data.summarizer),

            note: "Use returned URLs as sources. Do not invent facts that are not present in the snippets/results.",
        };
    } catch (error) {
        logError(error instanceof Error ? error : String(error));

        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const data = axios.isAxiosError(error) ? error.response?.data : undefined;

        return {
            ok: false,
            status: typeof status === "number" ? status : null,
            error: error instanceof Error ? error.message : String(error),
            response: data ?? null,
        };
    } finally {
        logger.debug("done", {duration: logger.duration(startedAt)});
    }
}

function mapBraveResult(result: BraveSearchResult) {
    return {
        title: cleanSearchText(result.title),
        url: asNonEmptyString(result.url) ?? null,
        description: cleanSearchText(result.description),
        age: asNonEmptyString(result.age) ?? asNonEmptyString(result.page_age) ?? null,
        language: asNonEmptyString(result.language) ?? null,
        source: asNonEmptyString(result.profile?.name)
            ?? asNonEmptyString(result.profile?.long_name)
            ?? asNonEmptyString(result.meta_url?.hostname)
            ?? null,
        hostname: asNonEmptyString(result.meta_url?.hostname) ?? null,
        thumbnail: asNonEmptyString(result.thumbnail?.src)
            ?? asNonEmptyString(result.thumbnail?.original)
            ?? null,
        extraSnippets: Array.isArray(result.extra_snippets)
            ? result.extra_snippets
                .map(cleanSearchText)
                .filter((value): value is string => Boolean(value))
            : [],
    };
}
