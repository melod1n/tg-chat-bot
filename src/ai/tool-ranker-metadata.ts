import type {BoundaryValue} from "../common/boundary-types";

export type ToolRankerExample = {
    user: string;
    toolNames: string[];
    note?: string;
};

export type ToolRankerToolInfo = {
    name: string;
    description: string;
    rankerHint: string;
    examples?: ToolRankerExample[];
};

const tool = (
    name: string,
    description: string,
    rankerHint: string,
    examples: ToolRankerExample[] = [],
): ToolRankerToolInfo => ({
    name,
    description,
    rankerHint,
    examples: examples.length ? examples : undefined,
});

const example = (user: string, toolNames: string[], note?: string): ToolRankerExample => ({
    user,
    toolNames,
    note,
});

export const TOOL_RANKER_TOOL_INFOS = {
    no_tool: tool(
        "no_tool",
        "No tool action is needed.",
        "Use for normal answers, explanations, advice, planning, code writing without execution, rewriting, translation, and general conversation.",
        [
            example("объясни docker volumes", ["no_tool"]),
            example("напиши промпт для Claude", ["no_tool"]),
            example("как лучше спроектировать эту архитектуру?", ["no_tool"]),
        ],
    ),
    get_datetime: tool(
        "get_datetime",
        "Get the current date, time, or timezone-aware moment.",
        "Use for current date/time, today/tomorrow/yesterday, timezone-aware time, and calculations based on the current moment.",
        [
            example("какое сегодня число?", ["get_datetime"]),
            example("который час?", ["get_datetime"]),
            example("что будет через 10 дней?", ["get_datetime"]),
        ],
    ),
    get_financial_market_data: tool(
        "get_financial_market_data",
        "Get current market, price, currency, or ticker data.",
        "Use for current/recent stocks, crypto, fiat exchange rates, commodities, indices, futures, and market prices.",
        [
            example("сколько сейчас BTC?", ["get_financial_market_data"]),
            example("курс USD/RUB", ["get_financial_market_data"]),
            example("цена золота сейчас", ["get_financial_market_data"]),
        ],
    ),
    get_weather: tool(
        "get_weather",
        "Get current weather or forecast data.",
        "Use for weather, rain, snow, wind, temperature, forecast, and weather-dependent planning.",
        [
            example("погода завтра", ["get_weather"]),
            example("будет дождь сегодня?", ["get_weather"]),
            example("можно сегодня на велике?", ["get_weather"]),
        ],
    ),
    read_file: tool(
        "read_file",
        "Read a known local file path.",
        "Use when the user asks to read, open, inspect, or summarize a known local file path.",
        [
            example("прочитай src/index.ts", ["read_file"]),
            example("посмотри package.json", ["read_file"]),
            example("открой этот файл", ["read_file"]),
        ],
    ),
    list_directory: tool(
        "list_directory",
        "List files or folders in a local path.",
        "Use when the user asks to list files/folders, inspect a directory, show project structure, or see what exists in a path.",
        [
            example("покажи структуру проекта", ["list_directory"]),
            example("что лежит в src?", ["list_directory"]),
            example("выведи список файлов", ["list_directory"]),
        ],
    ),
    search_files: tool(
        "search_files",
        "Search local files by name, content, symbol, or keyword.",
        "Use when the exact file path is unknown and the user wants to find files, usages, TODOs, symbols, classes, functions, or error messages.",
        [
            example("найди где используется sendMessage", ["search_files"]),
            example("найди все TODO", ["search_files"]),
            example("где определён BotService?", ["search_files"]),
        ],
    ),
    create_file: tool(
        "create_file",
        "Create a new small file.",
        "Use when the user asks to create a new file with specific content.",
        [
            example("создай README.md", ["create_file"]),
            example("создай .env.example", ["create_file"]),
            example("сделай docker-compose.yml", ["create_file"]),
        ],
    ),
    update_file: tool(
        "update_file",
        "Replace an existing file completely.",
        "Use only for full file replacement or overwrite.",
        [
            example("полностью перезапиши config.json", ["update_file"]),
            example("замени файл этой версией", ["update_file"]),
            example("overwrite this file", ["update_file"]),
        ],
    ),
    edit_file_patch: tool(
        "edit_file_patch",
        "Apply a targeted patch to an existing file.",
        "Use for targeted edits, patches, diffs, refactors, and changes that should preserve most of the file.",
        [
            example("исправь этот баг патчем", ["edit_file_patch"]),
            example("добавь эту опцию в существующий конфиг", ["edit_file_patch"]),
            example("измени только эту функцию", ["edit_file_patch"]),
        ],
    ),
    create_directory: tool(
        "create_directory",
        "Create directories or folder trees.",
        "Use when the user asks to create folders or directory structures.",
        [
            example("создай папку src/services", ["create_directory"]),
            example("создай структуру директорий", ["create_directory"]),
        ],
    ),
    copy_path: tool(
        "copy_path",
        "Copy a file or folder path.",
        "Use when the user asks to copy or duplicate a file or folder.",
        [
            example("скопируй config.example.json в config.json", ["copy_path"]),
            example("дублируй эту папку", ["copy_path"]),
        ],
    ),
    rename_path: tool(
        "rename_path",
        "Rename or move a file or folder.",
        "Use when the user asks to rename or move a file or folder.",
        [
            example("переименуй файл", ["rename_path"]),
            example("перемести notes.md в archive", ["rename_path"]),
        ],
    ),
    delete_path: tool(
        "delete_path",
        "Delete a file or folder.",
        "Use only when the user clearly asks to delete or remove something.",
        [
            example("удали папку dist", ["delete_path"]),
            example("remove node_modules", ["delete_path"]),
            example("delete this file", ["delete_path"]),
        ],
    ),
    send_file_as_attachment: tool(
        "send_file_as_attachment",
        "Send a local file as an attachment.",
        "Use when the user wants to receive, export, send, attach, or download a local file as an attachment.",
        [
            example("пришли мне этот файл", ["send_file_as_attachment"]),
            example("отправь заметку файлом", ["send_file_as_attachment"]),
            example("export this as attachment", ["send_file_as_attachment"]),
        ],
    ),
    begin_file_write: tool(
        "begin_file_write",
        "Start a large chunked file write.",
        "Use with write_file_chunk and finish_file_write for large file creation or writing.",
        [
            example("создай большой markdown отчёт", ["begin_file_write", "write_file_chunk", "finish_file_write"]),
            example("запиши большой файл чанками", ["begin_file_write", "write_file_chunk", "finish_file_write"]),
        ],
    ),
    write_file_chunk: tool(
        "write_file_chunk",
        "Append a chunk to an active large file write.",
        "Use together with begin_file_write and finish_file_write for chunked file writing.",
    ),
    finish_file_write: tool(
        "finish_file_write",
        "Complete an active large file write.",
        "Use together with begin_file_write and write_file_chunk to finish chunked file writing.",
    ),
    cancel_file_write: tool(
        "cancel_file_write",
        "Cancel an active large file write.",
        "Use when the user asks to cancel an active file write operation.",
        [
            example("отмени запись файла", ["cancel_file_write"]),
            example("cancel file write", ["cancel_file_write"]),
        ],
    ),
    shell_execute: tool(
        "shell_execute",
        "Run shell commands in the workspace environment.",
        "Use for terminal commands, tests, builds, docker, git, npm, pnpm, bun, gradle, diagnostics, logs, install commands, or system inspection.",
        [
            example("запусти npm test", ["shell_execute"]),
            example("собери проект", ["shell_execute"]),
            example("проверь docker logs", ["shell_execute"]),
        ],
    ),
    python_interpreter: tool(
        "python_interpreter",
        "Execute Python code.",
        "Use when the user explicitly asks to run Python code, execute Python, calculate with Python, or test a Python script.",
        [
            example("выполни этот python код", ["python_interpreter"]),
            example("посчитай это питоном", ["python_interpreter"]),
            example("напиши и запусти python скрипт", ["python_interpreter"]),
        ],
    ),
    code_interpreter: tool(
        "code_interpreter",
        "Run sandboxed code and data analysis.",
        "Use for sandbox computation, data/file analysis, CSV processing, archive processing, charts, tables, and generated reports.",
        [
            example("проанализируй CSV", ["code_interpreter"]),
            example("построй график", ["code_interpreter"]),
            example("обработай архив", ["code_interpreter"]),
        ],
    ),
    image_generation: tool(
        "image_generation",
        "Generate or edit an image.",
        "Use when the user asks to generate, create, edit, transform, restyle, enhance, remove, add, replace, recolor, upscale, or alter an image.",
        [
            example("сделай его лысым", ["image_generation"]),
            example("убери фон", ["image_generation"]),
            example("сделай в стиле аниме", ["image_generation"]),
        ],
    ),
    web_search: tool(
        "web_search",
        "Search the public web for current, recent, or external information.",
        "Use only for current/recent/public online information, search, verification, links, documentation, comparisons, or external data.",
        [
            example("найди актуальную документацию OpenAI API", ["web_search"]),
            example("проверь, вышел ли Kotlin 2.3", ["web_search"]),
            example("какие сейчас цены на VPS?", ["web_search"]),
        ],
    ),
    file_search: tool(
        "file_search",
        "Search uploaded documents or indexed vector-store files.",
        "Use for uploaded documents, vector stores, PDFs/docs already indexed or attached to the assistant context.",
        [
            example("найди в моих документах про MCP", ["file_search"]),
            example("что в загруженном PDF написано про оплату?", ["file_search"]),
            example("поищи в базе знаний", ["file_search"]),
        ],
    ),
} as const satisfies Record<string, ToolRankerToolInfo>;

export type ToolRankerToolName = keyof typeof TOOL_RANKER_TOOL_INFOS;

function isString(value: BoundaryValue): value is string {
    return typeof value === "string";
}

function normalizeToolNames(names: readonly string[]): string[] {
    const unique: string[] = [];

    for (const name of names) {
        if (!name || unique.includes(name)) {
            continue;
        }

        unique.push(name);
    }

    return unique;
}

function extractJsonCandidate(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
        return "";
    }

    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) {
        return fenced[1].trim();
    }

    const firstObjectStart = trimmed.indexOf("{");
    const lastObjectEnd = trimmed.lastIndexOf("}");
    if (firstObjectStart !== -1 && lastObjectEnd !== -1 && lastObjectEnd > firstObjectStart) {
        return trimmed.slice(firstObjectStart, lastObjectEnd + 1).trim();
    }

    const firstArrayStart = trimmed.indexOf("[");
    const lastArrayEnd = trimmed.lastIndexOf("]");
    if (firstArrayStart !== -1 && lastArrayEnd !== -1 && lastArrayEnd > firstArrayStart) {
        return trimmed.slice(firstArrayStart, lastArrayEnd + 1).trim();
    }

    return trimmed;
}

function parseSelectionValue(value: BoundaryValue): string[] {
    if (typeof value === "string") {
        return [value];
    }

    if (Array.isArray(value)) {
        return value.filter(isString);
    }

    if (value !== null && typeof value === "object") {
        const rawToolNames = (value as Record<string, BoundaryValue>).toolNames;
        return parseSelectionValue(rawToolNames as BoundaryValue);
    }

    return [];
}

function asOptionalString(value: BoundaryValue): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: BoundaryValue): value is Record<string, BoundaryValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toolNamesFromTool(tool: BoundaryValue): string[] {
    if (!isRecord(tool)) {
        return [];
    }

    const functionValue = isRecord(tool.function) ? tool.function : undefined;
    const directName = functionValue?.name ?? tool.name ?? (typeof tool.type === "string" && tool.type !== "function" ? tool.type : undefined);
    const name = asOptionalString(directName);

    return name ? [name] : [];
}

function fallbackToolInfoFromTool(toolValue: BoundaryValue, name: string): ToolRankerToolInfo | undefined {
    if (!isRecord(toolValue)) return undefined;

    const fn = isRecord(toolValue.function) ? toolValue.function : undefined;
    const description = asOptionalString(fn?.description ?? toolValue.description)
        ?? `Tool ${name}.`;

    return tool(
        name,
        description,
        "Use when the tool description matches the user's request.",
    );
}

export function getToolRankerToolInfo(name: string): ToolRankerToolInfo | undefined {
    return TOOL_RANKER_TOOL_INFOS[name as ToolRankerToolName];
}

export function getToolRankerToolInfos(names: readonly string[]): ToolRankerToolInfo[] {
    return normalizeToolNames(names)
        .map(name => getToolRankerToolInfo(name))
        .filter((tool): tool is ToolRankerToolInfo => !!tool);
}

export function getToolRankerAvailableToolInfos(availableTools: readonly BoundaryValue[]): ToolRankerToolInfo[] {
    const infos = new Map<string, ToolRankerToolInfo>();

    infos.set("no_tool", TOOL_RANKER_TOOL_INFOS.no_tool);

    for (const tool of availableTools) {
        for (const name of toolNamesFromTool(tool)) {
            if (infos.has(name)) continue;

            const known = getToolRankerToolInfo(name);
            const fallback = fallbackToolInfoFromTool(tool, name);
            if (known) {
                infos.set(name, known);
            } else if (fallback) {
                infos.set(name, fallback);
            }
        }
    }

    return [...infos.values()];
}

function renderToolLine(tool: ToolRankerToolInfo, compact: boolean): string {
    if (compact) {
        return `- ${tool.name}: ${tool.rankerHint}`;
    }

    return `- ${tool.name}: ${tool.description}\n  ${tool.rankerHint}`;
}

function renderExamples(tool: ToolRankerToolInfo, maxExamplesPerTool: number): string[] {
    if (!tool.examples?.length || maxExamplesPerTool <= 0) {
        return [];
    }

    return tool.examples.slice(0, maxExamplesPerTool).flatMap(example => {
        const lines = [
            `User: ${JSON.stringify(example.user)}`,
        ];

        if (example.note?.trim()) {
            lines.push(`Note: ${example.note.trim()}`);
        }

        lines.push(JSON.stringify({toolNames: example.toolNames}));
        return lines;
    });
}

function buildPriorityLines(tools: readonly ToolRankerToolInfo[]): string[] {
    const names = new Set(tools.map(tool => tool.name));
    const lines: string[] = [];

    const pushIfAvailable = (name: string, line: string): void => {
        if (names.has(name)) {
            lines.push(`- ${line}`);
        }
    };

    pushIfAvailable("get_datetime", "current date/time -> get_datetime");
    pushIfAvailable("get_financial_market_data", "market prices, currency, crypto, stocks -> get_financial_market_data");
    pushIfAvailable("get_weather", "weather or forecast -> get_weather");
    pushIfAvailable("image_generation", "image creation or editing -> image_generation");
    pushIfAvailable("file_search", "uploaded/vector documents -> file_search");
    pushIfAvailable("read_file", "known local file path -> read_file");
    pushIfAvailable("list_directory", "project structure or directory listing -> list_directory");
    pushIfAvailable("search_files", "local file/content search or unknown file path -> search_files");
    pushIfAvailable("edit_file_patch", "targeted existing file edit -> edit_file_patch");
    pushIfAvailable("update_file", "full existing file replacement -> update_file");
    pushIfAvailable("create_file", "small new file -> create_file");
    pushIfAvailable("begin_file_write", "large file writing -> begin_file_write + write_file_chunk + finish_file_write");
    pushIfAvailable("delete_path", "delete/remove only when the user clearly asks -> delete_path");
    pushIfAvailable("shell_execute", "terminal commands, builds, tests, git, docker -> shell_execute");
    pushIfAvailable("python_interpreter", "explicit Python execution -> python_interpreter");
    pushIfAvailable("code_interpreter", "sandbox computation or data analysis -> code_interpreter");

    return lines;
}

function buildRulesSection(availableToolNames: readonly string[]): string[] {
    const names = new Set(availableToolNames);
    const rules: string[] = [
        "You are a tool router, not an answering model.",
        "Your only job is to select the minimal set of tools needed for the user's latest request.",
        "Return ONLY valid JSON: {\"toolNames\":[\"tool1\",\"tool2\"]}",
        "No explanations.",
        "No markdown.",
        "No arguments.",
        "Use only tool names from Available tools.",
        "If no tool is needed, return {\"toolNames\":[\"no_tool\"]}.",
        "Pick the smallest correct tool set.",
        "Prefer specialized tools over generic tools.",
        "Use multiple tools only when the request likely needs a combination of capabilities.",
        "Be extra careful with destructive tools.",
    ];

    if (names.has("web_search")) {
        rules.push("Do not use web_search just because you are unsure.");
    }

    if (names.has("delete_path")) {
        rules.push("delete_path only when the user clearly asks to delete or remove something.");
    }

    if (names.has("update_file")) {
        rules.push("update_file only for full file replacement.");
    }

    if (names.has("edit_file_patch")) {
        rules.push("edit_file_patch for targeted file edits.");
    }

    return rules;
}

export function buildToolRankerSystemPrompt(params: {
    availableTools: ToolRankerToolInfo[];
    includeExamples?: boolean;
    maxExamplesPerTool?: number;
    compact?: boolean;
}): string {
    const includeExamples = params.includeExamples ?? false;
    const maxExamplesPerTool = Math.max(0, params.maxExamplesPerTool ?? 1);
    const compact = params.compact ?? true;
    const availableTools = params.availableTools;
    const availableToolNames = availableTools.map(tool => tool.name);

    const sections: string[] = [
        ...buildRulesSection(availableToolNames),
        "",
        "Available tools:",
        ...availableTools.map(tool => renderToolLine(tool, compact)),
    ];

    const priorityLines = buildPriorityLines(availableTools);
    if (priorityLines.length) {
        sections.push("", "Priority:", ...priorityLines);
    }

    if (includeExamples) {
        const exampleLines = availableTools.flatMap(tool => renderExamples(tool, maxExamplesPerTool));
        if (exampleLines.length) {
            sections.push("", "Examples:", ...exampleLines);
        }
    }

    sections.push("", "Return ONLY JSON.");
    return sections.join("\n");
}

export function sanitizeToolRankerResult(params: {
    raw: string;
    availableToolNames: readonly string[];
}): string[] {
    const raw = params.raw.trim();
    if (!raw) {
        return ["no_tool"];
    }

    const candidate = extractJsonCandidate(raw);
    let parsed: BoundaryValue;

    try {
        parsed = JSON.parse(candidate) as BoundaryValue;
    } catch {
        return ["no_tool"];
    }

    const availableToolNames = new Set(params.availableToolNames.filter(Boolean));
    const selected: string[] = [];

    for (const name of normalizeToolNames(parseSelectionValue(parsed))) {
        if (name === "no_tool") {
            selected.push(name);
            continue;
        }

        if (availableToolNames.has(name)) {
            selected.push(name);
        }
    }

    const deduped = normalizeToolNames(selected);
    const withoutNoTool = deduped.filter(name => name !== "no_tool");

    return withoutNoTool.length > 0 ? withoutNoTool : ["no_tool"];
}
