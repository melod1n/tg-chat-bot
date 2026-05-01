export type TelegramRenderMode = "draft" | "final";

export interface TelegramMarkdownV2RenderOptions {
    /**
     * draft:
     * - useful for streaming/editMessageText
     * - temporarily closes unfinished code blocks / inline code / bold
     *
     * final:
     * - use after LLM finished generation
     */
    mode?: TelegramRenderMode;

    /**
     * Used when the rendered message is empty.
     */
    fallbackText?: string;
}

/**
 * Main function.
 *
 * Flow:
 * LLM Markdown-lite
 * -> draft safety, if needed
 * -> normalize unsupported Markdown
 * -> parse Markdown-lite
 * -> render valid Telegram MarkdownV2
 */
export function prepareTelegramMarkdownV2(
    input: string,
    options: TelegramMarkdownV2RenderOptions = {},
): string {
    const mode = options.mode ?? "final";
    const fallbackText = options.fallbackText ?? "…";

    try {
        const safeInput = mode === "draft"
            ? makePartialMarkdownLiteSafe(input)
            : input;

        const normalized = normalizeUnsupportedMarkdown(safeInput);
        const ast = parseMarkdownLite(normalized);
        const rendered = renderMarkdownV2(ast).trim();

        return rendered || escapeMarkdownV2Text(fallbackText);
    } catch {
        const fallback = escapeMarkdownV2Text(input).trim();
        return fallback || escapeMarkdownV2Text(fallbackText);
    }
}

/**
 * Useful for editMessageText fallback.
 */
export function prepareTelegramPlainMarkdownV2(input: string, fallbackText = "…"): string {
    const escaped = escapeMarkdownV2Text(input).trim();
    return escaped || escapeMarkdownV2Text(fallbackText);
}

/**
 * Draft-safe mode for streaming.
 *
 * Fixes cases like:
 *
 * ```ts
 * const x =
 *
 * or:
 *
 * *partial bold
 *
 * or:
 *
 * `partial code
 */
export function makePartialMarkdownLiteSafe(input: string): string {
    let text = input.replace(/\r\n?/g, "\n");

    if (isInsideFencedCodeBlock(text)) {
        return closeUnclosedFencedCodeBlock(text);
    }

    return transformOutsideFencedCode(text, (outside) => {
        let result = outside;
        result = closeUnclosedInlineCode(result);
        result = closeUnclosedBold(result);
        return result;
    });
}

/**
 * Converts unsupported / annoying Markdown into simpler Markdown-lite.
 *
 * Does not transform fenced code blocks.
 */
export function normalizeUnsupportedMarkdown(input: string): string {
    const text = input.replace(/\r\n?/g, "\n").trim();

    return transformOutsideFencedCode(text, (raw) => {
        let result = raw;

        result = normalizeMarkdownTables(result);

        result = result
            // Images: ![alt](url) -> [alt](url)
            .replace(/!\[([^\]\n]*)]\(([^)\n]+)\)/g, "[$1]($2)")

            // Common Markdown bold -> Markdown-lite bold
            .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
            .replace(/__([^_\n]+)__/g, "*$1*")

            .replace(/^`([^`\n]+)$/gm, (_, title: string) => {
                const cleanTitle = title.trim();
                return cleanTitle ? `*${cleanTitle}*` : "";
            })

            // Headings -> bold labels
            .replace(/^#{1,6}\s+(.+)$/gm, (_, title: string) => {
                const cleanTitle = title
                    .replace(/[*_`[\]()~>#+\-=|{}.!]/g, "")
                    .trim();

                return cleanTitle ? `*${cleanTitle}*` : "";
            })

            // Horizontal rules
            .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, "")

            // Task lists -> normal bullets
            .replace(/^(\s*)[-*]\s+\[[ xX]]\s+/gm, "$1- ")

            // HTML line breaks -> newline
            .replace(/<br\s*\/?>/gi, "\n")

            // Strip simple raw HTML tags, keep content
            .replace(/<\/?(?:p|div|span|strong|b|em|i|u|s|del|code|pre)[^>]*>/gi, "")

            // Too many blank lines
            .replace(/\n{3,}/g, "\n\n");

        return result.trim();
    });
}

/**
 * AST
 */

type InlineNode =
    | { type: "text"; value: string }
    | { type: "bold"; children: InlineNode[] }
    | { type: "code"; value: string }
    | { type: "link"; text: string; url: string };

type BlockNode =
    | { type: "paragraph"; children: InlineNode[] }
    | { type: "pre"; lang?: string; value: string }
    | { type: "quote"; lines: InlineNode[][] };

/**
 * Block parser:
 * - fenced code blocks
 * - quotes
 * - paragraphs
 */
export function parseMarkdownLite(input: string): BlockNode[] {
    const lines = input.replace(/\r\n?/g, "\n").split("\n");
    const blocks: BlockNode[] = [];

    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) {
            i++;
            continue;
        }

        const fenceStart = line.match(/^```\s*([^`]*)\s*$/);

        if (fenceStart) {
            const lang = sanitizeCodeLanguage(fenceStart[1]);
            const body: string[] = [];

            i++;

            while (i < lines.length && !/^```\s*$/.test(lines[i])) {
                body.push(lines[i]);
                i++;
            }

            if (i < lines.length) {
                i++;
            }

            blocks.push({
                type: "pre",
                lang,
                value: body.join("\n"),
            });

            continue;
        }

        if (/^\s*>\s?/.test(line)) {
            const quoteLines: InlineNode[][] = [];

            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                const quoteLine = lines[i].replace(/^\s*>\s?/, "");
                quoteLines.push(parseInlineMarkdownLite(quoteLine));
                i++;
            }

            blocks.push({
                type: "quote",
                lines: quoteLines,
            });

            continue;
        }

        const paragraphLines: string[] = [];

        while (
            i < lines.length &&
            lines[i].trim() &&
            !/^```\s*([^`]*)\s*$/.test(lines[i]) &&
            !/^\s*>\s?/.test(lines[i])
            ) {
            paragraphLines.push(lines[i]);
            i++;
        }

        if (paragraphLines.length === 0) {
            paragraphLines.push(lines[i]);
            i++;
        }

        blocks.push({
            type: "paragraph",
            children: parseInlineMarkdownLite(paragraphLines.join("\n")),
        });
    }

    return blocks;
}

/**
 * Inline parser:
 * - *bold*
 * - `code`
 * - [text](url)
 *
 * This is intentionally not a full Markdown parser.
 */
export function parseInlineMarkdownLite(source: string): InlineNode[] {
    const nodes: InlineNode[] = [];
    let buffer = "";
    let i = 0;

    const flushText = () => {
        if (buffer) {
            nodes.push({ type: "text", value: buffer });
            buffer = "";
        }
    };

    while (i < source.length) {
        const ch = source[i];

        if (ch === "`") {
            const end = findNextUnescaped(source, "`", i + 1);

            if (end !== -1) {
                flushText();

                nodes.push({
                    type: "code",
                    value: source.slice(i + 1, end),
                });

                i = end + 1;
                continue;
            }
        }

        if (ch === "[") {
            const labelEnd = findNextUnescaped(source, "]", i + 1);

            if (labelEnd !== -1 && source[labelEnd + 1] === "(") {
                const urlStart = labelEnd + 2;
                const urlEnd = findMarkdownLinkEnd(source, urlStart);

                if (urlEnd !== -1) {
                    const text = source.slice(i + 1, labelEnd).trim();
                    const url = source.slice(urlStart, urlEnd).trim();

                    if (text && isSafeUrl(url)) {
                        flushText();

                        nodes.push({
                            type: "link",
                            text,
                            url,
                        });

                        i = urlEnd + 1;
                        continue;
                    }
                }
            }
        }

        if (ch === "*" && canStartBold(source, i)) {
            const end = findBoldEnd(source, i + 1);

            if (end !== -1 && canEndBold(source, end)) {
                const content = source.slice(i + 1, end);

                if (content.trim()) {
                    flushText();

                    nodes.push({
                        type: "bold",
                        children: parseInlineMarkdownLite(content),
                    });

                    i = end + 1;
                    continue;
                }
            }
        }

        buffer += ch;
        i++;
    }

    flushText();

    return nodes;
}

/**
 * MarkdownV2 renderer
 */

export function renderMarkdownV2(blocks: BlockNode[]): string {
    return blocks
        .map(renderBlockMarkdownV2)
        .filter(Boolean)
        .join("\n\n")
        .trim();
}

function renderBlockMarkdownV2(block: BlockNode): string {
    switch (block.type) {
        case "paragraph":
            return renderInlineMarkdownV2(block.children);

        case "pre": {
            const lang = block.lang ? block.lang : "";
            const code = escapeMarkdownV2Code(block.value);

            if (lang) {
                return "```" + lang + "\n" + code + "\n```";
            }

            return "```\n" + code + "\n```";
        }

        case "quote":
            return block.lines
                .map((line) => ">" + renderInlineMarkdownV2(line))
                .join("\n");
    }
}

function renderInlineMarkdownV2(nodes: InlineNode[]): string {
    return nodes.map(renderInlineNodeMarkdownV2).join("");
}

function renderInlineNodeMarkdownV2(node: InlineNode): string {
    switch (node.type) {
        case "text":
            return escapeMarkdownV2Text(node.value);

        case "bold":
            return "*" + renderInlineMarkdownV2(node.children) + "*";

        case "code":
            return "`" + escapeMarkdownV2Code(node.value) + "`";

        case "link":
            return `[${escapeMarkdownV2Text(node.text)}](${escapeMarkdownV2LinkUrl(node.url)})`;
    }
}

/**
 * Telegram MarkdownV2 escaping
 */

export function escapeMarkdownV2Text(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

export function escapeMarkdownV2Code(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`");
}

export function escapeMarkdownV2LinkUrl(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\)/g, "\\)");
}

/**
 * Draft safety helpers
 */

function closeUnclosedFencedCodeBlock(input: string): string {
    if (!isInsideFencedCodeBlock(input)) {
        return input;
    }

    return input.endsWith("\n")
        ? input + "```"
        : input + "\n```";
}

function isInsideFencedCodeBlock(input: string): boolean {
    const fenceMatches = [...input.matchAll(/^```/gm)];
    return fenceMatches.length % 2 === 1;
}

function closeUnclosedInlineCode(input: string): string {
    let count = 0;
    let escaped = false;

    for (const ch of input) {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (ch === "\\") {
            escaped = true;
            continue;
        }

        if (ch === "`") {
            count++;
        }
    }

    return count % 2 === 1 ? input + "`" : input;
}

function closeUnclosedBold(input: string): string {
    let count = 0;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (ch === "\\") {
            escaped = true;
            continue;
        }

        if (ch !== "*") {
            continue;
        }

        if (isLikelyListMarker(input, i)) {
            continue;
        }

        count++;
    }

    return count % 2 === 1 ? input + "*" : input;
}

function isLikelyListMarker(input: string, index: number): boolean {
    const prev = input[index - 1];
    const next = input[index + 1];

    const isLineStart = index === 0 || prev === "\n";
    return isLineStart && next === " ";
}

/**
 * Generic helpers
 */

function findNextUnescaped(source: string, target: string, from: number): number {
    for (let i = from; i < source.length; i++) {
        if (source[i] === "\\" && i + 1 < source.length) {
            i++;
            continue;
        }

        if (source[i] === target) {
            return i;
        }
    }

    return -1;
}

function findBoldEnd(source: string, from: number): number {
    for (let i = from; i < source.length; i++) {
        if (source[i] === "\\" && i + 1 < source.length) {
            i++;
            continue;
        }

        if (source[i] === "*") {
            return i;
        }
    }

    return -1;
}

function findMarkdownLinkEnd(source: string, from: number): number {
    let depth = 0;

    for (let i = from; i < source.length; i++) {
        const ch = source[i];

        if (ch === "\\" && i + 1 < source.length) {
            i++;
            continue;
        }

        if (ch === "\n") {
            return -1;
        }

        if (ch === "(") {
            depth++;
            continue;
        }

        if (ch === ")") {
            if (depth === 0) {
                return i;
            }

            depth--;
        }
    }

    return -1;
}

function canStartBold(source: string, index: number): boolean {
    const prev = source[index - 1];
    const next = source[index + 1];

    if (!next || /\s/.test(next)) {
        return false;
    }

    if (prev && /\w/.test(prev) && /\w/.test(next)) {
        return false;
    }

    return true;
}

function canEndBold(source: string, index: number): boolean {
    const prev = source[index - 1];
    const next = source[index + 1];

    if (!prev || /\s/.test(prev)) {
        return false;
    }

    if (next && /\w/.test(prev) && /\w/.test(next)) {
        return false;
    }

    return true;
}

function sanitizeCodeLanguage(value: string | undefined): string | undefined {
    if (!value) return undefined;

    const lang = value.trim();

    if (!lang) return undefined;

    // Telegram language hint after ``` can be used as a visual label too.
    // Keep it permissive, but reject dangerous/newline/weird marker chars.
    if (!/^[^\s`\\]{1,32}$/.test(lang)) {
        return undefined;
    }

    return lang;
}

function isSafeUrl(url: string): boolean {
    return /^(https?:\/\/|tg:\/\/|mailto:)/i.test(url);
}

/**
 * Applies transform only outside fenced code blocks.
 */
function transformOutsideFencedCode(
    input: string,
    transform: (text: string) => string,
): string {
    const fences: string[] = [];
    const fenceRegex = /```[^\n]*\n[\s\S]*?(?:\n```|$)/g;

    const protectedText = input.replace(fenceRegex, (match) => {
        const index = fences.push(match) - 1;
        return `\uE000FENCE_${index}\uE001`;
    });

    const transformed = transform(protectedText);

    return transformed.replace(/\uE000FENCE_(\d+)\uE001/g, (_, index: string) => {
        return fences[Number(index)] ?? "";
    });
}

/**
 * Converts Markdown tables into simple list rows.
 *
 * Example:
 * | A | B |
 * |---|---|
 * | 1 | 2 |
 *
 * ->
 * - A: 1; B: 2
 */
function normalizeMarkdownTables(input: string): string {
    const lines = input.split("\n");
    const output: string[] = [];

    let i = 0;

    while (i < lines.length) {
        const current = lines[i];
        const next = lines[i + 1];

        if (next && isMarkdownTableSeparator(next) && current.includes("|")) {
            const headers = parseTableRow(current);
            const rows: string[][] = [];

            i += 2;

            while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
                rows.push(parseTableRow(lines[i]));
                i++;
            }

            if (rows.length === 0) {
                output.push(headers.join(" / "));
                continue;
            }

            for (const row of rows) {
                const cells = row
                    .map((cell, index) => {
                        const header = headers[index];

                        if (!cell) return "";
                        if (!header) return cell;

                        return `${header}: ${cell}`;
                    })
                    .filter(Boolean);

                output.push(`- ${cells.join("; ")}`);
            }

            continue;
        }

        output.push(current);
        i++;
    }

    return output.join("\n");
}

function isMarkdownTableSeparator(line: string): boolean {
    const cells = parseTableRow(line);

    return (
        cells.length >= 2 &&
        cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
    );
}

function parseTableRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

/**
 * Optional helper for streaming/editing.
 *
 * You can adapt this to your own bot wrapper.
 */
export function shouldEditRenderedMessage(previous: string, next: string): boolean {
    return previous !== next && next.trim().length > 0;
}