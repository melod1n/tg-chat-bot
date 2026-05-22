import path from "node:path";
import {readFile, rename, writeFile, mkdir, rm} from "node:fs/promises";
import {AiProvider} from "../../model/ai-provider.js";
import {Environment} from "../../common/environment.js";
import {createMistralClient, createOllamaClient, createOpenAiClient, resolveOptionalAiRuntimeTarget, type AiRuntimeTarget} from "../ai-runtime-target.js";
import {AiTool} from "../tool-types.js";
import {toolsLogger} from "./tool-logger.js";
import {asNonEmptyString} from "./utils.js";

const logger = toolsLogger.child("user-memory");

function memoryDir(): string {
    return path.join(Environment.DATA_PATH, "memory");
}

export const USER_MEMORY_MAX_CHARS = 1000;

export type MemoryScope = "user" | "system";
export type MemoryAction = "add" | "replace" | "remove";

export type MemoryRuntimeContext = {
    provider?: AiProvider;
    runtimeTarget?: AiRuntimeTarget;
};

export type MemoryOperationResult =
    | {success: true; scope: MemoryScope; filePath: string; content: string; chars: number; compressed: boolean}
    | {success: false; scope: MemoryScope; error: string};

type CompressionRunResult = {
    content: string;
};

export type MemoryCompressionRunner = (params: {
    target: AiRuntimeTarget;
    scope: MemoryScope;
    currentText: string;
    limit: number;
}) => Promise<string>;

function extractMistralText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map(part => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object" && "text" in part && typeof (part as {text?: unknown}).text === "string") {
                return (part as {text: string}).text;
            }
            return "";
        })
        .join("");
}

export type MemoryToolName =
    | "read_user_info"
    | "read_system_info"
    | "add_user_info"
    | "add_system_info"
    | "remove_user_info"
    | "remove_system_info"
    | "replace_user_info"
    | "replace_system_info"
    | "delete_user_info"
    | "delete_system_info";

export const MEMORY_TOOL_NAMES: MemoryToolName[] = [
    "read_user_info",
    "read_system_info",
    "add_user_info",
    "add_system_info",
    "remove_user_info",
    "remove_system_info",
    "replace_user_info",
    "replace_system_info",
    "delete_user_info",
    "delete_system_info",
];

type MemoryToolSpec = {
    name: MemoryToolName;
    scope: MemoryScope;
    kind: "read" | "write" | "delete";
    action?: MemoryAction;
    description: string;
    prompt: string;
};

const MEMORY_TOOL_SPECS: MemoryToolSpec[] = [
    {
        name: "read_user_info",
        scope: "user",
        kind: "read",
        description: "Read persistent user memory from user.md.",
        prompt: `Use when you need to inspect remembered user facts before editing or answering.`,
    },
    {
        name: "read_system_info",
        scope: "system",
        kind: "read",
        description: "Read persistent assistant memory from system.md.",
        prompt: `Use when you need to inspect remembered assistant instructions before editing or answering.`,
    },
    {
        name: "add_user_info",
        scope: "user",
        kind: "write",
        action: "add",
        description: "Append a durable fact about the user to user.md.",
        prompt: `Use for new user facts, preferences, identity details, and profile information. Keep the result at or below ${USER_MEMORY_MAX_CHARS} characters.`,
    },
    {
        name: "add_system_info",
        scope: "system",
        kind: "write",
        action: "add",
        description: "Append a durable instruction about the assistant to system.md.",
        prompt: `Use for new assistant identity, style, or behavior instructions. Keep the result at or below ${USER_MEMORY_MAX_CHARS} characters.`,
    },
    {
        name: "remove_user_info",
        scope: "user",
        kind: "write",
        action: "remove",
        description: "Remove a specific user fact or fragment from user.md.",
        prompt: `Use when the user asks to forget something about themselves. Keep the result at or below ${USER_MEMORY_MAX_CHARS} characters.`,
    },
    {
        name: "remove_system_info",
        scope: "system",
        kind: "write",
        action: "remove",
        description: "Remove a specific assistant instruction or fragment from system.md.",
        prompt: `Use when the user asks to forget something about the assistant. Keep the result at or below ${USER_MEMORY_MAX_CHARS} characters.`,
    },
    {
        name: "replace_user_info",
        scope: "user",
        kind: "write",
        action: "replace",
        description: "Replace user.md completely with a new compact version.",
        prompt: `Use when the user wants to overwrite all remembered user info, such as "forget everything about me and remember only this". Keep the result at or below ${USER_MEMORY_MAX_CHARS} characters.`,
    },
    {
        name: "replace_system_info",
        scope: "system",
        kind: "write",
        action: "replace",
        description: "Replace system.md completely with a new compact version.",
        prompt: `Use when the user wants to overwrite all remembered assistant info or instructions. Keep the result at or below ${USER_MEMORY_MAX_CHARS} characters.`,
    },
    {
        name: "delete_user_info",
        scope: "user",
        kind: "delete",
        description: "Delete the user memory file user.md.",
        prompt: `Use when the user asks to delete all remembered user info and remove the memory file entirely.`,
    },
    {
        name: "delete_system_info",
        scope: "system",
        kind: "delete",
        description: "Delete the assistant memory file system.md.",
        prompt: `Use when the user asks to delete all remembered assistant info and remove the memory file entirely.`,
    },
];

export const memoryToolPrompt = [
    "Use the memory tools to manage persistent per-user memory.",
    "- `read_*` shows the current file content before editing.",
    "- `user.md` stores durable facts about the user.",
    "- `system.md` stores durable facts/instructions about the assistant itself.",
    "- `add_*` appends a new fact or instruction.",
    "- `remove_*` removes a specific fact or fragment.",
    "- `replace_*` rewrites the whole file when the user wants to overwrite memory.",
    "- `delete_*` removes the file entirely.",
    `- Keep each file at or below ${USER_MEMORY_MAX_CHARS} characters.`,
].join("\n");

function createMemoryTool(spec: MemoryToolSpec): AiTool {
    return {
        type: "function",
        function: {
            name: spec.name,
            description: spec.description,
            parameters: {
                type: "object",
                properties: spec.kind === "read" || spec.kind === "delete" ? {} : {
                    content: {
                        type: "string",
                        description: spec.action === "remove"
                            ? "Exact text or fragment to remove from memory."
                            : "Text to append or replace in memory.",
                    },
                },
                required: spec.kind === "read" || spec.kind === "delete" ? [] : ["content"],
            },
        },
    } satisfies AiTool;
}

export const memoryTools = MEMORY_TOOL_SPECS.map(createMemoryTool);

function normalizeUserId(userId: number): number | null {
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function normalizeMemoryText(value: string): string {
    return value.replaceAll("\r\n", "\n");
}

function getMemoryUserDir(userId: number): string {
    return path.join(memoryDir(), String(userId));
}

export function getMemoryFilePath(userId: number, scope: MemoryScope): string {
    return path.join(getMemoryUserDir(userId), `${scope}.md`);
}

async function ensureMemoryDir(userId: number): Promise<string> {
    const dir = getMemoryUserDir(userId);
    await mkdir(dir, {recursive: true});
    return dir;
}

async function readMemoryFile(userId: number, scope: MemoryScope): Promise<string> {
    const filePath = getMemoryFilePath(userId, scope);
    try {
        return normalizeMemoryText(await readFile(filePath, "utf-8"));
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
            return "";
        }

        throw error;
    }
}

async function writeMemoryFile(userId: number, scope: MemoryScope, content: string): Promise<string> {
    const normalized = normalizeMemoryText(content);
    const filePath = getMemoryFilePath(userId, scope);
    await ensureMemoryDir(userId);

    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, normalized, "utf-8");
    await rename(tempPath, filePath);
    return filePath;
}

function trimToLimit(content: string, limit = USER_MEMORY_MAX_CHARS): string {
    if (content.length <= limit) return content;
    return content.slice(0, limit).trimEnd();
}

function stripCodeFences(content: string): string {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) return fenced[1].trim();
    return trimmed;
}

function sameTarget(left: AiRuntimeTarget | undefined, right: AiRuntimeTarget | undefined): boolean {
    if (!left || !right) return false;
    return left.provider === right.provider
        && left.model === right.model
        && (left.baseUrl ?? "") === (right.baseUrl ?? "")
        && (left.apiKey ?? "") === (right.apiKey ?? "");
}

async function compressWithTarget(params: {
    target: AiRuntimeTarget;
    scope: MemoryScope;
    currentText: string;
    limit: number;
}): Promise<CompressionRunResult> {
    const {target, scope, currentText, limit} = params;

    const systemPrompt = [
        "You compress persistent memory for a chat bot.",
        "Return only the rewritten Markdown text.",
        "Preserve important facts, preferences, identities, instructions, and durable context.",
        "Remove noise, duplication, stale details, and low-value filler.",
        `Keep the result at or below ${limit} characters.`,
        "Do not add explanations, bullet labels, or code fences.",
    ].join("\n");

    const userPrompt = [
        `Memory scope: ${scope}`,
        `Character limit: ${limit}`,
        "Current memory:",
        currentText.trim() || "(empty)",
        "",
        "Rewrite it as compact Markdown only.",
    ].join("\n");

    logger.info("compress.start", {provider: target.provider, model: target.model, scope, chars: currentText.length});

    switch (target.provider) {
        case AiProvider.OPENAI: {
            const client = createOpenAiClient(target);
            const response = await client.chat.completions.create({
                model: target.model,
                temperature: 0,
                messages: [
                    {role: "system", content: systemPrompt},
                    {role: "user", content: userPrompt},
                ],
            });
            const text = response.choices[0]?.message?.content ?? "";
            return {content: stripCodeFences(text)};
        }
        case AiProvider.MISTRAL: {
            const client = createMistralClient(target);
            const response = await client.chat.complete({
                model: target.model,
                temperature: 0,
                messages: [
                    {role: "system", content: systemPrompt},
                    {role: "user", content: userPrompt},
                ],
            } as Parameters<typeof client.chat.complete>[0]);
            const text = extractMistralText(response.choices?.[0]?.message?.content);
            return {content: stripCodeFences(text)};
        }
        case AiProvider.OLLAMA: {
            const client = createOllamaClient(target);
            const response = await client.chat({
                model: target.model,
                stream: false,
                options: {temperature: 0},
                messages: [
                    {role: "system", content: systemPrompt},
                    {role: "user", content: userPrompt},
                ],
            });
            const text = typeof response.message?.content === "string" ? response.message.content : "";
            return {content: stripCodeFences(text)};
        }
    }
}

export async function compressMemoryWithFallback(params: {
    provider?: AiProvider;
    currentTarget?: AiRuntimeTarget;
    scope: MemoryScope;
    currentText: string;
    limit?: number;
}, runner: MemoryCompressionRunner = async (input) => (await compressWithTarget(input)).content): Promise<{content: string; compressed: boolean; usedTarget?: AiRuntimeTarget}> {
    const limit = params.limit ?? USER_MEMORY_MAX_CHARS;
    const trimmed = normalizeMemoryText(params.currentText);
    if (trimmed.length <= limit) {
        return {content: trimmed, compressed: false};
    }

    const explicitTarget = params.provider ? resolveOptionalAiRuntimeTarget(params.provider, "memoryCompress") : undefined;
    const targets = [explicitTarget, params.currentTarget].filter((target, index, list): target is AiRuntimeTarget => !!target && list.findIndex(item => sameTarget(item, target)) === index);

    for (const target of targets) {
        try {
            const content = trimToLimit(await runner({target, scope: params.scope, currentText: trimmed, limit}), limit);
            if (content.length <= limit) {
                return {content, compressed: true, usedTarget: target};
            }
        } catch (error) {
            logger.warn("compress.failed", {
                provider: params.provider,
                scope: params.scope,
                target: target.model,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {content: trimToLimit(trimmed, limit), compressed: true};
}

async function compressMemoryIfNeeded(params: {
    userId: number;
    scope: MemoryScope;
    content: string;
    context?: MemoryRuntimeContext;
    limit?: number;
}): Promise<{content: string; compressed: boolean}> {
    const {scope, context, limit = USER_MEMORY_MAX_CHARS} = params;
    const result = await compressMemoryWithFallback({
        provider: context?.provider,
        currentTarget: context?.runtimeTarget,
        scope,
        currentText: params.content,
        limit,
    });

    if (!result.compressed) {
        return result;
    }

    if (result.content.length > limit) {
        return {content: trimToLimit(result.content, limit), compressed: true};
    }

    return {content: result.content, compressed: true};
}

async function finalizeMemoryWrite(params: {
    userId: number;
    scope: MemoryScope;
    content: string;
    context?: MemoryRuntimeContext;
}): Promise<{filePath: string; content: string; compressed: boolean}> {
    const {userId, scope, context} = params;
    const compressed = await compressMemoryIfNeeded({userId, scope, content: params.content, context});
    const filePath = await writeMemoryFile(userId, scope, compressed.content);
    return {filePath, content: compressed.content, compressed: compressed.compressed};
}

function findMemoryToolSpec(toolName: string): MemoryToolSpec | undefined {
    return MEMORY_TOOL_SPECS.find(spec => spec.name === toolName);
}

function isMemoryWriteTool(spec: MemoryToolSpec): spec is MemoryToolSpec & {kind: "write"; action: MemoryAction} {
    return spec.kind === "write";
}

export async function buildUserMemoryPrompt(userId: number | undefined | null): Promise<string | undefined> {
    const normalizedUserId = typeof userId === "number" ? normalizeUserId(userId) : null;
    if (!normalizedUserId) return undefined;

    const [userMemoryResult, systemMemoryResult] = await Promise.all([
        readUserMemory(normalizedUserId, "user"),
        readUserMemory(normalizedUserId, "system"),
    ]);

    const userMemory = userMemoryResult.success ? userMemoryResult.content : "";
    const systemMemory = systemMemoryResult.success ? systemMemoryResult.content : "";

    const blocks: string[] = [];
    if (systemMemory.trim()) {
        blocks.push([
            "## Assistant memory (system.md)",
            "This is information about the assistant and its behavior.",
            systemMemory.trim(),
        ].join("\n"));
    }
    if (userMemory.trim()) {
        blocks.push([
            "## User memory (user.md)",
            "This is information about the user.",
            userMemory.trim(),
        ].join("\n"));
    }

    return blocks.length ? blocks.join("\n\n") : undefined;
}

export async function readUserMemory(userId: number, scope: MemoryScope): Promise<MemoryOperationResult> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return {success: false, scope, error: "Invalid userId"};
    }

    try {
        const content = await readMemoryFile(normalizedUserId, scope);
        return {
            success: true,
            scope,
            filePath: getMemoryFilePath(normalizedUserId, scope),
            content,
            chars: content.length,
            compressed: false,
        };
    } catch (error) {
        return {success: false, scope, error: error instanceof Error ? error.message : String(error)};
    }
}

export async function updateUserMemory(args: {
    userId: number;
    scope: MemoryScope;
    action: MemoryAction;
    content?: string;
    context?: MemoryRuntimeContext;
}): Promise<MemoryOperationResult> {
    const normalizedUserId = normalizeUserId(args.userId);
    if (!normalizedUserId) {
        return {success: false, scope: args.scope, error: "Invalid userId"};
    }

    try {
        const current = await readMemoryFile(normalizedUserId, args.scope);
        let next = current;

        switch (args.action) {
            case "add": {
                const content = normalizeMemoryText(asNonEmptyString(args.content) ?? "");
                if (!content.trim()) {
                    return {success: false, scope: args.scope, error: "No content provided"};
                }
                next = [current.trimEnd(), content.trim()].filter(Boolean).join(current.trim() ? "\n\n" : "");
                break;
            }
            case "replace": {
                const content = normalizeMemoryText(asNonEmptyString(args.content) ?? "");
                next = content;
                break;
            }
            case "remove": {
                const needle = normalizeMemoryText(asNonEmptyString(args.content) ?? "");
                if (!needle.trim()) {
                    return {success: false, scope: args.scope, error: "No text to remove provided"};
                }
                if (!current.includes(needle)) {
                    return {success: false, scope: args.scope, error: "Text not found in memory"};
                }
                next = current.split(needle).join("").trim();
                break;
            }
        }

        const finalized = await finalizeMemoryWrite({userId: normalizedUserId, scope: args.scope, content: next, context: args.context});
        logger.debug("write.done", {
            userId: normalizedUserId,
            scope: args.scope,
            chars: finalized.content.length,
            compressed: finalized.compressed,
            filePath: finalized.filePath,
        });

        return {
            success: true,
            scope: args.scope,
            filePath: finalized.filePath,
            content: finalized.content,
            chars: finalized.content.length,
            compressed: finalized.compressed,
        };
    } catch (error) {
        return {success: false, scope: args.scope, error: error instanceof Error ? error.message : String(error)};
    }
}

export async function executeMemoryTool(toolName: MemoryToolName, args: {userId: number; content?: string}, context?: MemoryRuntimeContext): Promise<MemoryOperationResult> {
    const spec = findMemoryToolSpec(toolName);
    if (!spec) {
        return {success: false, scope: "user", error: `Unknown memory tool: ${toolName}`};
    }

    if (spec.kind === "read") {
        return readUserMemory(args.userId, spec.scope);
    }

    if (spec.kind === "delete") {
        return deleteUserMemory(args.userId, spec.scope);
    }

    if (!isMemoryWriteTool(spec)) {
        return {success: false, scope: spec.scope, error: `Unsupported memory tool: ${toolName}`};
    }

    return updateUserMemory({
        userId: args.userId,
        scope: spec.scope,
        action: spec.action,
        content: args.content,
        context,
    });
}

export async function deleteUserMemory(userId: number, scope: MemoryScope): Promise<MemoryOperationResult> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return {success: false, scope, error: "Invalid userId"};
    }

    const filePath = getMemoryFilePath(normalizedUserId, scope);
    try {
        await rm(filePath, {force: true});
        return {success: true, scope, filePath, content: "", chars: 0, compressed: false};
    } catch (error) {
        return {success: false, scope, error: error instanceof Error ? error.message : String(error)};
    }
}
