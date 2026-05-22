import {AiTool} from "../tool-types.js";
import path from "node:path";
import {readdir, readFile} from "node:fs/promises";
import {notesDir, notesRootFile} from "../../index.js";
import {asNonEmptyString} from "./utils.js";
import {toolsLogger} from "./tool-logger.js";
import {AiJsonObject, AiJsonValue} from "../tool-types.js";

const logger = toolsLogger.child("search-notes");

export type SearchNoteMatchedField = "file_name" | "title" | "content";

export type SearchNoteItem = {
    fileName: string;
    filePath: string;
    relativePath: string;
    title: string;
    score: number;
    matchedFields: SearchNoteMatchedField[];
    snippet?: string;
};

export type SearchNotesResult =
    | { success: true; results: SearchNoteItem[] }
    | { success: false; error: string };

export const searchNotesTool = {
    type: "function",
    function: {
        name: "search_notes",
        description:
            "Search Markdown notes by file name, note title, and full note content. Supports fuzzy matching. Use this when the user refers to a note by title, topic, partial title, approximate name, keyword, or something written inside the note. Returns success=true and results[], where each result contains fileName, title, score, matchedFields, relativePath, and optional snippet. Later note tools should use results[0].fileName unless multiple results are ambiguous.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Search query for finding notes by file name, title, topic, keywords, or content. Can be partial, approximate, or contain typos. Use a short clean phrase, not the full user sentence.",
                },
                limit: {
                    type: "integer",
                    description:
                        "Maximum number of search results to return. Defaults to 3. Maximum is 10.",
                    minimum: 1,
                    maximum: 10,
                    default: 3,
                },
            },
            required: ["query"],
        },
    },
} satisfies AiTool;

export async function searchNotes(
    args?: AiJsonObject,
): Promise<SearchNotesResult> {
    const startedAt = Date.now();
    logger.debug("start", {args});

    const query = asNonEmptyString(args?.query) ?? "";
    if (!query.trim().length) {
        return {success: false, error: "No query provided"};
    }

    const limit = parseSearchLimit(args?.limit);

    try {
        const entries = await readdir(notesDir, {withFileTypes: true});

        const markdownFiles = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((fileName) => fileName.endsWith(".md"));

        const notes = await Promise.all(
            markdownFiles.map(async (fileName) => {
                const filePath = path.join(notesDir, fileName);
                const relativePath = path.relative(path.dirname(notesRootFile), filePath);

                let content = "";
                try {
                    content = await readFile(filePath, "utf-8");
                } catch {
                    // Ignore content read errors for individual files.
                }

                const title = extractNoteTitle(fileName, content);
                const fileNameWithoutExtension = path.basename(fileName, ".md");

                const fileNameScore = calculateFuzzyScore(query, fileNameWithoutExtension);
                const titleScore = calculateFuzzyScore(query, title);
                const contentScore = calculateContentScore(query, content);

                const matchedFields: SearchNoteMatchedField[] = [];

                if (fileNameScore > 0) {
                    matchedFields.push("file_name");
                }

                if (titleScore > 0) {
                    matchedFields.push("title");
                }

                if (contentScore > 0) {
                    matchedFields.push("content");
                }

                const score = Math.max(
                    fileNameScore,
                    titleScore,
                    contentScore,
                );

                return {
                    fileName,
                    filePath,
                    relativePath,
                    title,
                    score,
                    matchedFields,
                    snippet:
                        contentScore > 0
                            ? buildContentSnippet(query, content)
                            : undefined,
                };
            }),
        );

        const results = notes
            .filter((note) => note.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        logger.debug("done", {query, limit, results: results.length, duration: logger.duration(startedAt)});
        return {success: true, results};
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to search notes: ${errorMessage}`};
    }
}

function parseSearchLimit(value: AiJsonValue | undefined): number {
    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string"
                ? Number.parseInt(value, 10)
                : 3;

    if (!Number.isFinite(parsed)) {
        return 3;
    }

    return Math.max(1, Math.min(10, Math.floor(parsed)));
}

function extractNoteTitle(fileName: string, content: string): string {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const heading = headingMatch?.[1]?.trim();

    if (heading) {
        return heading;
    }

    return path.basename(fileName, ".md");
}

function calculateFuzzyScore(query: string, value: string): number {
    const normalizedQuery = normalizeSearchText(query);
    const normalizedValue = normalizeSearchText(value);

    if (!normalizedQuery.length || !normalizedValue.length) {
        return 0;
    }

    if (normalizedValue === normalizedQuery) {
        return 100;
    }

    if (normalizedValue.startsWith(normalizedQuery)) {
        return 90;
    }

    if (normalizedValue.includes(normalizedQuery)) {
        return 85;
    }

    const queryWords = normalizedQuery.split(" ").filter(Boolean);
    const valueWords = normalizedValue.split(" ").filter(Boolean);

    const wordMatchScore = calculateWordMatchScore(queryWords, valueWords);
    const subsequenceScore = isSubsequence(normalizedQuery, normalizedValue) ? 55 : 0;
    const distanceScore = calculateLevenshteinScore(normalizedQuery, normalizedValue);

    return Math.max(wordMatchScore, subsequenceScore, distanceScore);
}

function calculateContentScore(query: string, content: string): number {
    const normalizedQuery = normalizeSearchText(query);
    const normalizedContent = normalizeSearchText(content);

    if (!normalizedQuery.length || !normalizedContent.length) {
        return 0;
    }

    if (normalizedContent.includes(normalizedQuery)) {
        return 70;
    }

    const queryWords = normalizedQuery.split(" ").filter(Boolean);
    const contentWords = new Set(normalizedContent.split(" ").filter(Boolean));

    if (!queryWords.length) {
        return 0;
    }

    let matchedWords = 0;

    for (const queryWord of queryWords) {
        if (contentWords.has(queryWord)) {
            matchedWords++;
            continue;
        }

        const hasPartialMatch = [...contentWords].some((contentWord) => {
            if (contentWord.includes(queryWord) || queryWord.includes(contentWord)) {
                return true;
            }

            if (queryWord.length < 4 || contentWord.length < 4) {
                return false;
            }

            const distance = levenshteinDistance(queryWord, contentWord);
            const maxLength = Math.max(queryWord.length, contentWord.length);
            const similarity = 1 - distance / maxLength;

            return similarity >= 0.75;
        });

        if (hasPartialMatch) {
            matchedWords += 0.75;
        }
    }

    const matchRatio = matchedWords / queryWords.length;

    if (matchRatio <= 0) {
        return 0;
    }

    return Math.round(matchRatio * 60);
}

function normalizeSearchText(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ё/g, "е")
        .replace(/[^a-zа-я0-9\s-]/gi, " ")
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ");
}

function calculateWordMatchScore(queryWords: string[], valueWords: string[]): number {
    if (!queryWords.length || !valueWords.length) {
        return 0;
    }

    let matchedWords = 0;

    for (const queryWord of queryWords) {
        const bestWordScore = Math.max(
            ...valueWords.map((valueWord) => {
                if (valueWord === queryWord) {
                    return 1;
                }

                if (valueWord.startsWith(queryWord) || valueWord.includes(queryWord)) {
                    return 0.85;
                }

                const distance = levenshteinDistance(queryWord, valueWord);
                const maxLength = Math.max(queryWord.length, valueWord.length);
                const similarity = 1 - distance / maxLength;

                return similarity >= 0.7 ? similarity : 0;
            }),
        );

        if (bestWordScore > 0) {
            matchedWords += bestWordScore;
        }
    }

    const ratio = matchedWords / queryWords.length;
    return Math.round(ratio * 75);
}

function calculateLevenshteinScore(query: string, value: string): number {
    const distance = levenshteinDistance(query, value);
    const maxLength = Math.max(query.length, value.length);

    if (maxLength === 0) {
        return 0;
    }

    const similarity = 1 - distance / maxLength;

    if (similarity < 0.45) {
        return 0;
    }

    return Math.round(similarity * 65);
}

function isSubsequence(query: string, value: string): boolean {
    let queryIndex = 0;

    for (const valueChar of value) {
        if (valueChar === query[queryIndex]) {
            queryIndex++;
        }

        if (queryIndex === query.length) {
            return true;
        }
    }

    return false;
}

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = Array.from({length: a.length + 1}, () =>
        Array.from({length: b.length + 1}, () => 0),
    );

    for (let i = 0; i <= a.length; i++) {
        matrix[i][0] = i;
    }

    for (let j = 0; j <= b.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;

            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            );
        }
    }

    return matrix[a.length][b.length];
}

function buildContentSnippet(query: string, content: string): string | undefined {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedContent = content.toLowerCase();

    let matchIndex = normalizedContent.indexOf(normalizedQuery);

    if (matchIndex < 0) {
        const queryWords = normalizeSearchText(query)
            .split(" ")
            .filter((word) => word.length >= 3);

        for (const word of queryWords) {
            matchIndex = normalizedContent.indexOf(word);
            if (matchIndex >= 0) {
                break;
            }
        }
    }

    if (matchIndex < 0) {
        return undefined;
    }

    const snippetRadius = 120;
    const start = Math.max(0, matchIndex - snippetRadius);
    const end = Math.min(content.length, matchIndex + normalizedQuery.length + snippetRadius);

    const prefix = start > 0 ? "..." : "";
    const suffix = end < content.length ? "..." : "";

    return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}
