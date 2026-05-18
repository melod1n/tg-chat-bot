import {Message} from "typescript-telegram-bot-api";
import * as fs from "node:fs";
import path from "node:path";
import type {BoundaryValue} from "../common/boundary-types";
import {AiProvider} from "../model/ai-provider.js";
import {ToolRankerFallbackPolicy} from "../common/policies.js";
import {Environment} from "../common/environment.js";
import {delay, logError, replyToMessage} from "../util/utils.js";
import {MessageStore} from "../common/message-store.js";
import type {OpenAiResponseTool} from "./tool-mappers.js";
import {AiProviderName, getOpenAICodeInterpreterTool, getOpenAIResponsesTools} from "./tool-mappers.js";
import {TelegramArtifactFile, TelegramStreamMessage} from "./telegram-stream-message.js";
import {AiDownloadedFile} from "./telegram-attachments.js";
import {getRuntimeCapabilities} from "./provider-model-runtime.js";
import {StoredAttachment} from "../model/stored-attachment.js";
import {AiChatMessage, ChatMessage} from "./chat-messages-types.js";
import {ListResponse, Ollama} from "ollama";
import {executeToolCall, ToolRuntimeContext} from "./tools/runtime.js";
import {MessageImagePart, MessagePart} from "../common/message-part.js";
import {KeyedAsyncLock} from "../util/async-lock.js";
import {type AiRequestQueueTarget} from "./provider-request-queue.js";
import {PYTHON_INTERPRETER_TOOL_NAME, pythonInterpreterToolPrompt} from "./tools/python-interpretator.js";
import {getResponseLanguageInstruction, UserAiResponseLanguage, UserAiVoiceMode} from "../common/user-ai-settings.js";
import {
    isTranscribableAudioDownload,
    resolveSpeechToTextProviderForUser,
    transcribeSpeechDownloads
} from "./speech-to-text.js";
import type {ChatCompletionMessageParam} from "openai/resources/chat/completions";
import {MistralChatMessage} from "./mistral-chat-message.js";
import {prepareTelegramMarkdownV2} from "../util/markdown-v2-renderer.js";
import {AiRuntimeTarget, createMistralClient, resolveAiRuntimeTarget} from "./ai-runtime-target.js";
import {aiLog, aiLogDuration, aiLogProviderTarget, aiLogToolCall} from "../logging/ai-logger.js";
import {buildConversationSnapshot, serializeConversationSnapshot} from "./conversation-pipeline.js";
import type {ResponseInputMessageContentList} from "openai/resources/responses/responses";
import {persistToolResultArtifactAttachment} from "./tool-result-artifact-store.js";
import {filterUserVisibleStoredAttachments} from "../common/attachment-visibility.js";

export type {Message} from "typescript-telegram-bot-api";
export type {AiRuntimeTarget} from "./ai-runtime-target";
export type {AiDownloadedFile} from "./telegram-attachments";
export type {StoredAttachment} from "../model/stored-attachment";
export type {AiChatMessage, ChatMessage} from "./chat-messages-types";
export type {ToolRuntimeContext} from "./tools/runtime";
export type {MessageImagePart, MessagePart} from "../common/message-part";
export type {OpenAIChatMessage} from "./openai-chat-message";
export type {MistralChatMessage} from "./mistral-chat-message";
export type {OllamaChatMessage} from "./ollama-chat-message";
export type {TelegramArtifactFile} from "./telegram-stream-message";
export {TelegramStreamMessage} from "./telegram-stream-message";
export type {ChatRequest, ListResponse, Ollama, Tool} from "ollama";
export type {
    ResponseCreateParamsNonStreaming,
    ResponseCreateParamsStreaming,
    ResponseInputItem,
    ResponseInputMessageContentList,
    ResponseStreamEvent,
} from "openai/resources/responses/responses";
export type {
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
    ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
export const TELEGRAM_LIMIT = 4096;
export const MAX_TOOL_ROUNDS = 40;
export const MAX_IDENTICAL_TOOL_CALLS = 1;
export const OPENAI_IMAGE_PARTIALS = 3;
export const AI_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
export const MIN_OLLAMA_CONTEXT_SIZE = 4096;
export const MAX_OLLAMA_CONTEXT_SIZE = 262144;
export const DEFAULT_OLLAMA_CONTEXT_SIZE = 32768;
export const toolResourceLocks = new KeyedAsyncLock();

function photoGenDir(): string {
    return path.join(Environment.DATA_PATH, "cache", "photo", "gen");
}

export type UnifiedRunOptions = {
    provider: AiProvider;
    msg: Message;
    isGuestMsg?: boolean;
    text: string;
    stream?: boolean;
    think?: Think;
    synthesizeSpeechResponse?: boolean;
    responseLanguage?: UserAiResponseLanguage;
    contextSize?: number;
    voiceMode?: UserAiVoiceMode;
    targetMessage?: Message;
};

export type ToolCallData = {
    id: string;
    name: string;
    argumentsText: string;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

// SDKs sometimes expose loose object-shaped payloads. Keep the looseness at the boundary,
// but do not spread it through the rest of the code.
export type LooseRecord = Record<string, JsonValue | object | undefined>;

export type OpenAiResponsesFunctionCall = {
    callId: string;
    name: string;
    argumentsText: string;
};

export type MistralToolCallLike = {
    id?: string;
    index?: number;
    name?: string;
    function?: {
        name?: string;
        arguments?: string | JsonObject;
    };
    arguments?: string | JsonObject;
};

export type MistralDeltaLike = {
    content?: string | Array<{ text?: string }> | null;
    toolCalls?: MistralToolCallLike[] | null;
    tool_calls?: MistralToolCallLike[] | null;
};

export type MistralLibraryLike = {
    id?: string;
};

export type MistralUploadedDocumentLike = {
    id?: string;
};

export type MistralDocumentStatusLike = {
    processingStatus?: string;
};

export type MistralDocumentReference = {
    type: "document";
    documentId: string;
};

export type OllamaToolCallLike = {
    function?: {
        name?: string;
        arguments?: JsonObject;
    };
};

export type OpenAiChatToolCallLike = {
    id?: string;
    type?: "function";
    index?: number;
    name?: string;
    function?: {
        name?: string;
        arguments?: string | JsonObject;
    };
    arguments?: string | JsonObject;
};

export type OpenAiResponseOutputItem = {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    result?: string;
    content?: Array<{ text?: string; refusal?: string }>;
    code?: string | null;
    container_id?: string;
    outputs?: Array<{ type?: "logs" | "image"; logs?: string; url?: string }> | null;
    status?: string;
};

export type OpenAiResponseLike = {
    id?: string;
    output?: OpenAiResponseOutputItem[];
    output_text?: string;
};

export type OpenAiCompatibleContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

export type OpenAiCompatibleChatMessage = ChatCompletionMessageParam;

export type OpenAiChatCompletionResponseLike = {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAiChatToolCallLike[] } }>;
};

export type OpenAiChatCompletionStreamChunkLike = {
    choices?: Array<{ delta?: { content?: string | null; tool_calls?: OpenAiChatToolCallLike[] } }>;
};

export type AsyncIterableStream<T> = AsyncIterable<T>;

export function isRecord(value: BoundaryValue): value is LooseRecord {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toJsonValue(value: BoundaryValue): JsonValue | undefined {
    if (value === null) return null;

    switch (typeof value) {
        case "string":
        case "boolean":
            return value;
        case "number":
            return Number.isFinite(value) ? value : null;
        case "object":
            if (Array.isArray(value)) {
                return value.map(item => toJsonValue(item) ?? null);
            }

            if (!isRecord(value)) return undefined;

            return Object.fromEntries(
                Object.entries(value)
                    .map(([key, item]) => [key, toJsonValue(item)] as const)
                    .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined),
            );
        default:
            return undefined;
    }
}

export function toJsonObject(value: BoundaryValue): JsonObject | undefined {
    const json = toJsonValue(value);
    return json !== null && typeof json === "object" && !Array.isArray(json) ? json : undefined;
}

export function asOptionalString(value: BoundaryValue): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function isAbortError(error: BoundaryValue): boolean {
    return error instanceof Error ? error.message.includes("Aborted") : String(error).includes("Aborted");
}

export type AttachmentKind = "image" | "document" | "audio" | "video" | "video-note";

export type Think = boolean | "high" | "medium" | "low";

export type RuntimeConfigSnapshot = {
    useNamesInPrompt: boolean;
    useSystemPrompt: boolean;
    systemPrompt?: string;
    rankerToolPrompt?: string;
    toolRankerFallbackPolicy: ToolRankerFallbackPolicy;

    ollamaChatTarget: AiRuntimeTarget;
    ollamaToolRankerTarget?: AiRuntimeTarget;
    ollamaToolTarget: AiRuntimeTarget;
    ollamaVisionTarget: AiRuntimeTarget;
    ollamaThinkingTarget: AiRuntimeTarget;
    ollamaAudioTarget: AiRuntimeTarget;
    ollamaDocumentsTarget: AiRuntimeTarget;
    ollamaRagChunkSize: number;
    ollamaRagChunkOverlap: number;
    ollamaRagTopK: number;
    ollamaRagMaxContextChars: number;
    ollamaRagMinScore: number;
    ollamaRagMaxArchiveFiles: number;
    ollamaRagMaxArchiveBytes: number;
    ollamaRagMaxArchiveDepth: number;
    mistralChatTarget: AiRuntimeTarget;
    mistralToolRankerTarget?: AiRuntimeTarget;

    openAiChatTarget: AiRuntimeTarget;
    openAiImageTarget: AiRuntimeTarget;
    openAiToolRankerTarget?: AiRuntimeTarget;
};

export function snapshotRuntimeConfig(): RuntimeConfigSnapshot {
    return {
        useNamesInPrompt: Environment.USE_NAMES_IN_PROMPT,
        useSystemPrompt: Environment.USE_SYSTEM_PROMPT,

        systemPrompt: Environment.SYSTEM_PROMPT,
        rankerToolPrompt: Environment.RANKER_TOOL_PROMPT,
        toolRankerFallbackPolicy: Environment.TOOL_RANKER_FALLBACK_POLICY,

        ollamaChatTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "chat"),
        ollamaToolRankerTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "toolRank"),
        ollamaToolTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "tools"),
        ollamaVisionTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "vision"),
        ollamaThinkingTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "thinking"),
        ollamaAudioTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "audio"),
        ollamaDocumentsTarget: resolveAiRuntimeTarget(AiProvider.OLLAMA, "documents"),
        ollamaRagChunkSize: Environment.OLLAMA_RAG_CHUNK_SIZE,
        ollamaRagChunkOverlap: Environment.OLLAMA_RAG_CHUNK_OVERLAP,
        ollamaRagTopK: Environment.OLLAMA_RAG_TOP_K,
        ollamaRagMaxContextChars: Environment.OLLAMA_RAG_MAX_CONTEXT_CHARS,
        ollamaRagMinScore: Environment.OLLAMA_RAG_MIN_SCORE,
        ollamaRagMaxArchiveFiles: Environment.OLLAMA_RAG_MAX_ARCHIVE_FILES,
        ollamaRagMaxArchiveBytes: Environment.OLLAMA_RAG_MAX_ARCHIVE_BYTES,
        ollamaRagMaxArchiveDepth: Environment.OLLAMA_RAG_MAX_ARCHIVE_DEPTH,

        mistralChatTarget: resolveAiRuntimeTarget(AiProvider.MISTRAL, "chat"),
        mistralToolRankerTarget: resolveAiRuntimeTarget(AiProvider.MISTRAL, "toolRank"),

        openAiChatTarget: resolveAiRuntimeTarget(AiProvider.OPENAI, "chat"),
        openAiImageTarget: resolveAiRuntimeTarget(AiProvider.OPENAI, "outputImages"),
        openAiToolRankerTarget: resolveAiRuntimeTarget(AiProvider.OPENAI, "toolRank"),
    };
}

export function getMessageImageParts(part: MessagePart): MessageImagePart[] {
    if (part.imageParts?.length) return part.imageParts;
    return (part.images ?? []).map(data => ({data, mimeType: "image/jpeg"}));
}

export function openAiImageDataUrl(image: MessageImagePart): string {
    return `data:${image.mimeType || "image/jpeg"};base64,${image.data}`;
}

export function snapshotModel(provider: AiProvider, config: RuntimeConfigSnapshot): string {
    switch (provider) {
        case AiProvider.OLLAMA:
            return config.ollamaChatTarget.model;
        case AiProvider.MISTRAL:
            return config.mistralChatTarget.model;
        case AiProvider.OPENAI:
            return config.openAiChatTarget.model;
    }
}

export function providerTargets(provider: AiProvider, config: RuntimeConfigSnapshot): AiRuntimeTarget[] {
    switch (provider) {
        case AiProvider.OLLAMA:
            return [
                config.ollamaChatTarget,
                config.ollamaToolRankerTarget,
                config.ollamaToolTarget,
                config.ollamaVisionTarget,
                config.ollamaThinkingTarget,
                config.ollamaAudioTarget,
                config.ollamaDocumentsTarget
            ].filter((target): target is AiRuntimeTarget => !!target);
        case AiProvider.MISTRAL:
            return [
                config.mistralChatTarget,
                config.mistralToolRankerTarget,
            ].filter((target): target is AiRuntimeTarget => !!target);
        case AiProvider.OPENAI:
            return [
                config.openAiChatTarget,
                config.openAiToolRankerTarget,
            ].filter((target): target is AiRuntimeTarget => !!target);
    }
}

export function providerChatTarget(provider: AiProvider, config: RuntimeConfigSnapshot): AiRuntimeTarget {
    switch (provider) {
        case AiProvider.OLLAMA:
            return config.ollamaChatTarget;
        case AiProvider.MISTRAL:
            return config.mistralChatTarget;
        case AiProvider.OPENAI:
            return config.openAiChatTarget;
    }
}

export function providerName(provider: AiProvider): AiProviderName {
    switch (provider) {
        case AiProvider.OLLAMA:
            return "ollama";
        case AiProvider.MISTRAL:
            return "mistral";
        case AiProvider.OPENAI:
            return "openai";
    }
}

export function buildSystemInstruction(
    config: RuntimeConfigSnapshot,
    responseLanguage: UserAiResponseLanguage,
    includePythonToolPrompt: boolean,
    additions?: string | null,
): string {
    return [
        config.useSystemPrompt ? getResponseLanguageInstruction(responseLanguage) : null,
        config.systemPrompt && config.useSystemPrompt ? config.systemPrompt : null,
        additions?.trim() ? additions.trim() : null,
        includePythonToolPrompt ? pythonInterpreterToolPrompt : null,
    ].filter(Boolean).join("\n\n");
}

export function initialStatus(downloads: AiDownloadedFile[], messagePartsImages: number): string {
    const documents = downloads.filter(d => d.kind === "document");
    const images = downloads.filter(d => d.kind === "image").length + messagePartsImages;
    const audio = downloads.filter(isTranscribableAudioDownload).length;

    if (documents.length) return prepareTelegramMarkdownV2(Environment.getAnalyzingDocumentText(documents.map(d => d.fileName)));
    if (audio) return Environment.transcribingAudioText;
    if (images > 1) return Environment.analyzingPicturesText;
    if (images === 1) return Environment.analyzingPictureText;
    return Environment.waitThinkText;
}

export function hasAudioAttachmentKind(kinds: Set<AttachmentKind>): boolean {
    return kinds.has("audio") || kinds.has("video-note");
}

export function resolveAiRequestQueueTarget(
    options: Pick<UnifiedRunOptions, "provider" | "think">,
    config: RuntimeConfigSnapshot,
    requestedAttachmentKinds: Set<AttachmentKind>,
): AiRequestQueueTarget {
    switch (options.provider) {
        case AiProvider.OLLAMA:
            if (hasAudioAttachmentKind(requestedAttachmentKinds)) return config.ollamaAudioTarget;
            if (requestedAttachmentKinds.has("image")) return config.ollamaVisionTarget;
            return options.think ? config.ollamaThinkingTarget : config.ollamaChatTarget;
        case AiProvider.MISTRAL:
            return config.mistralChatTarget;
        case AiProvider.OPENAI:
            return config.openAiChatTarget;
    }
}

export function roundStatus(round: number, firstRoundStatus: string, content?: string, toolCalls?: ToolCallData[], thinking?: boolean): string | null {
    if (content?.length && !toolCalls?.length && !thinking) {
        return null;
    }

    return toolCalls?.length ? Environment.getUseToolText(toolCalls)
        : thinking ? Environment.reasoningText
            : round === 0 ? firstRoundStatus
                : Environment.waitThinkText;
}

export function isPlainTextDocument(doc: AiDownloadedFile): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    const mime = (doc.mimeType ?? "").toLowerCase();

    return mime.startsWith("text/")
        || mime === "application/json"
        || mime === "application/xml"
        || [
            ".txt",
            ".md",
            ".markdown",
            ".csv",
            ".json",
            ".jsonl",
            ".xml",
            ".yaml",
            ".yml",
            ".ini",
            ".env",
            ".log",
            ".ps1",
            ".sh",
            ".bat",
            ".cmd",
            ".js",
            ".jsx",
            ".ts",
            ".tsx",
            ".py",
            ".rb",
            ".go",
            ".java",
            ".c",
            ".cc",
            ".cpp",
            ".h",
            ".hpp",
            ".php",
            ".sql",
        ].includes(ext);
}

export function decodeTextDocument(doc: AiDownloadedFile): string {
    return doc.buffer.toString("utf8").replace(/\u0000/g, "");
}

export function downloadedFileAsBlob(doc: AiDownloadedFile): Blob {
    const arrayBuffer = doc.buffer.buffer.slice(
        doc.buffer.byteOffset,
        doc.buffer.byteOffset + doc.buffer.byteLength,
    ) as ArrayBuffer;

    return new Blob([arrayBuffer], {
        type: doc.mimeType ?? "application/octet-stream",
    });
}

export function ollamaModelNames(response: ListResponse): string[] {
    return (response?.models ?? [])
        .flatMap((model) => [model?.model, model?.name])
        .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export async function isOllamaModelActive(ollama: Ollama, target: AiRuntimeTarget): Promise<boolean> {
    const active = await ollama.ps();
    return ollamaModelNames(active).includes(target.model);
}

export function addMessageAttachmentKinds(msg: Message | undefined, kinds: Set<AttachmentKind>): void {
    if (!msg) return;

    if (msg.photo?.length) kinds.add("image");
    if (msg.document) {
        const mimeType = msg.document.mime_type;
        kinds.add(mimeType?.startsWith("image/") ? "image" : mimeType?.startsWith("audio/") ? "audio" : "document");
    }
    if (msg.voice || msg.audio) kinds.add("audio");
    if (msg.video_note) kinds.add("video-note");
    if (msg.video) kinds.add("video");
}

export async function collectStoredReplyChainAttachments(msg: Message, limit: number = 1): Promise<StoredAttachment[]> {
    const attachments: StoredAttachment[] = [];
    const seen = new Set<string>();
    let current = await MessageStore.get(msg.chat.id, msg.message_id);

    for (let i = 0; current && i < limit; i++) {
        for (const attachment of filterUserVisibleStoredAttachments(current?.attachments ?? [])) {
            const key = [
                attachment.kind,
                attachment.fileUniqueId || attachment.fileId,
                attachment.cachePath,
            ].join(":");
            if (seen.has(key)) continue;
            seen.add(key);
            attachments.push(attachment);
        }
        current = await MessageStore.get(current.chatId, current.replyToMessageId);
    }

    return attachments;
}

export async function hasStoredReplyChainImage(msg: Message): Promise<boolean> {
    const attachments = await collectStoredReplyChainAttachments(msg);
    if (attachments.some(attachment => attachment.kind === "image")) return true;

    return false;
}

export async function collectRequestedAttachmentKinds(msg: Message): Promise<Set<AttachmentKind>> {
    const kinds = new Set<AttachmentKind>();

    addMessageAttachmentKinds(msg, kinds);
    addMessageAttachmentKinds(msg.reply_to_message, kinds);

    for (const attachment of await collectStoredReplyChainAttachments(msg)) {
        kinds.add(attachment.kind);
    }

    if (!kinds.has("image") && await hasStoredReplyChainImage(msg)) {
        kinds.add("image");
    }

    return kinds;
}

export function unsupportedAttachmentText(provider: AiProvider, model: string, kind: AttachmentKind): string {
    const providerName = provider.toLowerCase();

    switch (kind) {
        case "audio":
            return Environment.getCurrentModelUnsupportedInputText(model, providerName, "voice or audio messages");
        case "image":
            return Environment.getCurrentModelUnsupportedInputText(model, providerName, "images");
        case "document":
            return Environment.getCurrentModelUnsupportedInputText(model, providerName, "documents");
        case "video":
            return Environment.getCurrentModelUnsupportedInputText(model, providerName, "video");
        case "video-note":
            return Environment.getCurrentModelUnsupportedInputText(model, providerName, "video notes");
    }
}

export async function rejectUnsupportedAttachments(
    provider: AiProvider,
    model: string,
    msg: Message,
    config: RuntimeConfigSnapshot,
    requestedAttachmentKinds?: Set<AttachmentKind>,
): Promise<boolean> {
    const kinds = requestedAttachmentKinds ?? await collectRequestedAttachmentKinds(msg);
    let effectiveModel = model || snapshotModel(provider, config);
    const hasAudio = hasAudioAttachmentKind(kinds);

    if (provider === AiProvider.OLLAMA) {
        effectiveModel = hasAudio ? config.ollamaAudioTarget.model
            : kinds.has("image") ? config.ollamaVisionTarget.model
                : config.ollamaChatTarget.model;
    }

    const caps = await getRuntimeCapabilities(provider, effectiveModel);

    let speechToTextSupported = !hasAudio;
    if (hasAudio && msg.from?.id) {
        speechToTextSupported = await resolveSpeechToTextProviderForUser(msg.from.id, provider)
            .then(() => true)
            .catch(() => false);
    }

    const unsupported =
        (hasAudio && !speechToTextSupported ? "audio" : null) ??
        (kinds.has("image") && !caps.vision?.supported ? "image" : null) ??
        (kinds.has("document") && !caps.documents?.supported ? "document" : null) ??
        (kinds.has("video") ? "video" : null);

    if (!unsupported) return false;

    if (!kinds.has("audio")) {
        await replyToMessage({
            message: msg,
            text: unsupportedAttachmentText(provider, effectiveModel, unsupported),
        }).catch(logError);
    }

    return true;
}

export async function collectCachedMessageAttachments(msg: Message): Promise<{
    attachments: StoredAttachment[];
    missing: StoredAttachment[]
}> {
    const attachments = await collectStoredReplyChainAttachments(msg);
    return {
        attachments,
        missing: attachments.filter(attachment => !fs.existsSync(attachment.cachePath)),
    };
}

export function safeJsonParseObject(value?: string): JsonObject {
    if (!value?.trim()) return {};
    try {
        const parsed = JSON.parse(value);
        return toJsonObject(parsed) ?? {};
    } catch {
        return {};
    }
}

export type ToolArgumentsParseResult =
    | { ok: true; args: JsonObject }
    | { ok: false; message: string; raw: string };

export function parseToolArgumentsObject(argumentsText?: string): ToolArgumentsParseResult {
    const raw = argumentsText ?? "";

    if (!raw.trim()) {
        return {ok: true, args: {}};
    }

    try {
        const parsed = JSON.parse(raw);
        const args = toJsonObject(parsed);

        if (!args) {
            return {
                ok: false,
                raw,
                message: "Tool arguments must be a JSON object.",
            };
        }

        return {ok: true, args};
    } catch (error) {
        return {
            ok: false,
            raw,
            message: `Invalid JSON in tool arguments: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export function errorMessage(error: BoundaryValue): string {
    return error instanceof Error ? error.message : String(error);
}

export function toolFailureResult(kind: string, message: string, extra?: JsonObject): string {
    return JSON.stringify({
        success: false,
        error: {
            kind,
            message,
            ...(extra ?? {}),
        },
    });
}

export function toolRuntimeContextFromDownloads(downloads: AiDownloadedFile[]): ToolRuntimeContext {
    if (!downloads.length) return {};

    return {
        pythonInputFiles: downloads.map(download => ({
            kind: download.kind,
            path: download.path,
            fileName: download.fileName,
            mimeType: download.mimeType,
        })),
    };
}

export function extractToolArtifacts(toolName: string, result: string): TelegramArtifactFile[] {
    if (toolName !== PYTHON_INTERPRETER_TOOL_NAME) return [];

    try {
        const parsed = JSON.parse(result);
        const artifacts = isRecord(parsed) && Array.isArray(parsed.artifacts) ? parsed.artifacts : [];

        return artifacts
            .map(artifact => artifact as Partial<TelegramArtifactFile>)
            .filter((artifact): artifact is TelegramArtifactFile => {
                return (artifact.kind === "image" || artifact.kind === "file")
                    && typeof artifact.path === "string"
                    && typeof artifact.fileName === "string"
                    && Number.isSafeInteger(artifact.sizeBytes);
            });
    } catch {
        return [];
    }
}

export async function sendToolArtifacts(toolCall: ToolCallData, result: string, message: TelegramStreamMessage): Promise<void> {
    const artifacts = extractToolArtifacts(toolCall.name, result);
    for (const artifact of artifacts) {
        await message.sendArtifact(artifact);
    }
}

export function stringifyToolArguments(value: string | JsonObject | undefined): string {
    return typeof value === "string" ? value : JSON.stringify(value ?? {});
}

export function normalizeMistralToolCalls(calls: MistralToolCallLike[] = []): ToolCallData[] {
    return calls.map((call, i) => ({
        id: call.id || `call_${Date.now()}_${i}`,
        name: call.function?.name || call.name || "",
        argumentsText: stringifyToolArguments(call.function?.arguments ?? call.arguments),
    })).filter(c => c.name);
}

export function mistralToolCalls(value: MistralDeltaLike | {
    toolCalls?: MistralToolCallLike[] | null;
    tool_calls?: MistralToolCallLike[] | null
} | null | undefined): MistralToolCallLike[] {
    return value?.toolCalls ?? value?.tool_calls ?? [];
}

export function contentFromMistralDelta(delta: MistralDeltaLike): string {
    if (!delta.content) return "";
    if (typeof delta.content === "string") return delta.content;
    if (Array.isArray(delta.content)) return delta.content.map(c => c.text ?? "").join("");
    return "";
}

export function normalizeOllamaToolCalls(calls: readonly OllamaToolCallLike[] = [], round: number): ToolCallData[] {
    return calls
        .map((call, i) => ({
            id: `ollama_${round}_${i}`,
            name: call.function?.name ?? "",
            argumentsText: JSON.stringify(call.function?.arguments ?? {}),
        }))
        .filter(call => !!call.name);
}

export async function collectTextMessages(
    msg: Message,
    textOverride: string,
    provider: AiProvider,
    downloads: AiDownloadedFile[],
    config: RuntimeConfigSnapshot,
    runtimeTarget: AiRuntimeTarget,
    responseLanguage: UserAiResponseLanguage,
): Promise<{
    chatMessages: AiChatMessage[];
    imageCount: number
}> {
    const includePythonToolPrompt = Environment.ENABLE_PYTHON_INTERPRETER && msg.from?.id === Environment.CREATOR_ID;
    const snapshot = await buildConversationSnapshot(
        msg,
        textOverride,
        downloads,
        config,
        runtimeTarget,
        responseLanguage,
        includePythonToolPrompt,
    );

    return serializeConversationSnapshot(snapshot, provider, Environment.USE_NAMES_IN_PROMPT);
}

export async function transcribeAudioIfNeeded(provider: AiProvider, userId: number | undefined, downloads: AiDownloadedFile[], message: TelegramStreamMessage, signal: AbortSignal): Promise<string> {
    const audioDownloads = downloads.filter(isTranscribableAudioDownload);
    if (!audioDownloads.length) return "";
    if (!userId) throw new Error(Environment.couldNotIdentifyUserForSpeechToTextText);
    if (signal.aborted) throw new Error("Aborted");

    const startedAt = Date.now();
    aiLog("info", "speech_to_text.start", {
        requestedProvider: providerName(provider),
        userId,
        files: audioDownloads.map(d => ({
            kind: d.kind,
            fileName: d.fileName,
            mimeType: d.mimeType,
            sizeBytes: d.buffer.length
        })),
    });

    message.setStatus(Environment.transcribingAudioText);
    await message.flush();

    try {
        const resolved = await resolveSpeechToTextProviderForUser(userId, provider);
        aiLog("debug", "speech_to_text.provider_resolved", {provider: String(resolved.provider)});

        const transcript = await transcribeSpeechDownloads(resolved.provider, downloads, signal);
        if (!transcript.trim()) {
            throw new Error(Environment.speechToTextEmptyResultText);
        }

        aiLog("success", "speech_to_text.done", {
            duration: aiLogDuration(startedAt),
            transcriptChars: transcript.length,
        });
        return transcript;
    } catch (e) {
        aiLog("error", "speech_to_text.failed", {duration: aiLogDuration(startedAt), error: e instanceof Error ? e : String(e)});
        throw e;
    }
}

export function stripAudioFromRunnerMessages(parts: AiChatMessage[]): void {
    for (const part of parts) {
        if ("audios" in part) {
            delete part.audios;
        }
        if ("audioParts" in part) {
            delete part.audioParts;
        }

        if ("videoNotes" in part) {
            delete part.videoNotes;
        }
    }
}

export function appendTranscriptToChatMessages(
    chatMessages: AiChatMessage[],
    transcript: string,
): void {
    const lastUser = [...chatMessages].reverse().find(message => "role" in message && message.role === "user");
    if (!lastUser) return;

    const text = transcript.trim();
    if (!text) return;

    if (!("content" in lastUser)) return;

    if (typeof lastUser.content === "string") {
        lastUser.content = [lastUser.content, text].filter((value: string) => value.trim()).join("\n\n");
        return;
    }

    if (Array.isArray(lastUser.content)) {
        const usesOpenAiResponsesParts = lastUser.content.some(part => {
            if (!isRecord(part)) return false;

            // Do not read `part.type` directly here: for some providers TypeScript
            // narrows it to the Chat Completions union (`text | image_url | thinking`),
            // which makes comparisons with Responses parts (`input_text | input_image`)
            // look impossible even though this is a runtime mixed-provider guard.
            const partType = (part as {type?: string}).type;

            return partType === "input_text" || partType === "input_image";
        });

        if (usesOpenAiResponsesParts) {
            (lastUser.content as ResponseInputMessageContentList).push({type: "input_text", text});
        } else {
            (lastUser.content as OpenAiCompatibleContentPart[]).push({type: "text", text});
        }
    }
}

export async function deleteMistralLibrary(libraryId: string | undefined, target: AiRuntimeTarget): Promise<void> {
    if (!libraryId) return;

    const startedAt = Date.now();
    aiLog("debug", "mistral.library.delete.start", {libraryId, target: aiLogProviderTarget(target)});
    try {
        const mistralAi = createMistralClient(target);
        await mistralAi.beta.libraries.delete({libraryId});
        aiLog("success", "mistral.library.delete.done", {libraryId, duration: aiLogDuration(startedAt)});
    } catch (e) {
        aiLog("error", "mistral.library.delete.failed", {libraryId, duration: aiLogDuration(startedAt), error: e instanceof Error ? e : String(e)});
        logError(e instanceof Error ? e : String(e));
    }
}

export async function appendMistralTextDocument(doc: AiDownloadedFile, messages: MistralChatMessage[], message: TelegramStreamMessage): Promise<void> {
    const startedAt = Date.now();
    aiLog("info", "mistral.document.text.start", {
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.buffer.length,
    });

    message.setStatus(prepareTelegramMarkdownV2(Environment.getAnalyzingDocumentText([doc.fileName])));
    await message.flush();

    const text = decodeTextDocument(doc).trim();
    if (!text) {
        throw new Error(Environment.getDocumentIsEmptyText(doc.fileName));
    }

    messages.push({
        role: "user",
        content: [
            {
                type: "text",
                text: Environment.getDocumentContentText(doc.fileName, text),
            },
        ],
    });

    aiLog("success", "mistral.document.text.done", {
        fileName: doc.fileName,
        duration: aiLogDuration(startedAt),
        chars: text.length,
    });
}

export async function prepareMistralDocuments(downloads: AiDownloadedFile[], messages: MistralChatMessage[], message: TelegramStreamMessage, target: AiRuntimeTarget, signal: AbortSignal): Promise<{
    documents: MistralDocumentReference[];
    libraryId?: string
}> {
    const docs = downloads.filter(d => d.kind === "document");
    const result: MistralDocumentReference[] = [];
    if (!docs.length) return {documents: result};

    const startedAt = Date.now();
    aiLog("info", "mistral.documents.prepare.start", {
        target: aiLogProviderTarget(target),
        count: docs.length,
        documents: docs.map(d => ({fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.buffer.length})),
    });

    const mistralAi = createMistralClient(target);
    const library = await mistralAi.beta.libraries.create({
        name: `tg-chat-bot-${Date.now()}`,
        description: "Temporary library for document search",
    }, {signal});
    const libraryId = (library as MistralLibraryLike).id;
    if (!libraryId) {
        throw new Error(Environment.mistralLibraryIdMissingText);
    }

    aiLog("debug", "mistral.library.created", {libraryId});

    try {
        for (const doc of docs) {
            if (signal.aborted) throw new Error("Aborted");

            if (isPlainTextDocument(doc)) {
                await appendMistralTextDocument(doc, messages, message);
                continue;
            }

            message.setStatus(prepareTelegramMarkdownV2(Environment.getAnalyzingDocumentText([doc.fileName])));
            await message.flush();

            const documentStartedAt = Date.now();
            aiLog("info", "mistral.document.upload.start", {
                libraryId,
                fileName: doc.fileName,
                mimeType: doc.mimeType,
                sizeBytes: doc.buffer.length,
            });

            const uploaded = await mistralAi.beta.libraries.documents.upload({
                libraryId,
                requestBody: {
                    file: downloadedFileAsBlob(doc),
                },
            }, {signal});

            const uploadedDocument = uploaded as MistralUploadedDocumentLike & { document_id?: string };
            const documentId = uploadedDocument.id ?? uploadedDocument.document_id;
            if (!documentId) {
                throw new Error(Environment.getMistralUploadedDocumentIdMissingText(doc.fileName));
            }

            aiLog("debug", "mistral.document.upload.done", {
                libraryId,
                documentId,
                fileName: doc.fileName,
                duration: aiLogDuration(documentStartedAt),
            });

            let processed = false;
            for (let i = 0; i < 90; i++) {
                const info = await mistralAi.beta.libraries.documents.status({libraryId, documentId}, {signal});
                const statusInfo = info as MistralDocumentStatusLike & { status?: string; process_status?: string };
                const status = statusInfo.status ?? statusInfo.process_status ?? statusInfo.processingStatus;
                aiLog("debug", "mistral.document.status", {
                    libraryId,
                    documentId,
                    fileName: doc.fileName,
                    status,
                    attempt: i + 1
                });

                if (status === "processed" || status === "Completed" || status === "done" || status === "Done") {
                    processed = true;
                    break;
                }
                if (status === "failed" || status === "error" || status === "Failed" || status === "Error" || status === "missing_content") {
                    throw new Error(Environment.getMistralDocumentProcessingFailedText(doc.fileName, status));
                }
                await delay(2000, signal);
            }

            if (!processed) {
                throw new Error(Environment.getMistralDocumentProcessingTimedOutText(doc.fileName));
            }

            aiLog("success", "mistral.document.processed", {
                libraryId,
                documentId,
                fileName: doc.fileName,
                duration: aiLogDuration(documentStartedAt),
            });

            result.push({type: "document", documentId});
        }

        aiLog("success", "mistral.documents.prepare.done", {
            libraryId,
            count: docs.length,
            duration: aiLogDuration(startedAt),
        });
        return {documents: result, libraryId};
    } catch (e) {
        aiLog("error", "mistral.documents.prepare.failed", {
            libraryId,
            duration: aiLogDuration(startedAt),
            error: e instanceof Error ? e : String(e),
        });
        await deleteMistralLibrary(libraryId, target);
        throw e;
    }
}

export async function executeTool(
    userId: number | undefined | null,
    toolCall: ToolCallData,
    message: TelegramStreamMessage,
    context: ToolRuntimeContext,
): Promise<string> {
    const startedAt = Date.now();

    aiLog("info", "tool.start", {
        tool: aiLogToolCall(toolCall),
        hasPythonInputFiles: !!context.pythonInputFiles?.length,
    });

    await message.flush();

    const parsedArgs = parseToolArgumentsObject(toolCall.argumentsText);
    if (!parsedArgs.ok) {
        const result = toolFailureResult("invalid_arguments", parsedArgs.message, {
            raw: parsedArgs.raw.slice(0, 4000),
        });

        aiLog("warn", "tool.arguments.invalid", {
            tool: aiLogToolCall(toolCall),
            duration: aiLogDuration(startedAt),
            error: parsedArgs.message,
        });

        return result;
    }

    try {
        const rawResult = await executeToolCall(userId, toolCall.name, parsedArgs.args, context);
        const result = stringifyToolExecutionResult(rawResult);

        await sendToolArtifacts(toolCall, result, message);

        aiLog("success", "tool.done", {
            name: toolCall.name,
            duration: aiLogDuration(startedAt),
            result,
        });

        return result;
    } catch (error) {
        if (isAbortError(error instanceof Error ? error : String(error))) {
            throw error;
        }

        const result = toolFailureResult("execution_failed", errorMessage(error instanceof Error ? error : String(error)));

        aiLog("error", "tool.failed.returned_to_model", {
            name: toolCall.name,
            duration: aiLogDuration(startedAt),
            error: error instanceof Error ? error : String(error),
        });

        return result;
    }
}

export function toolResourceKeys(toolCall: ToolCallData): string[] {
    const args = safeJsonParseObject(toolCall.argumentsText);
    const pathValue = typeof args.path === "string" ? args.path : undefined;
    const sourcePath = typeof args.sourcePath === "string" ? args.sourcePath : undefined;
    const targetPath = typeof args.targetPath === "string" ? args.targetPath : undefined;

    switch (toolCall.name) {
        case "get_datetime":
        case "web_search":
        case "get_weather":
        case "read_file":
        case "list_directory":
            return [];
        case "create_file":
        case "create_directory":
        case "update_file":
        case "delete_path":
            return [`file:${pathValue ?? "*"}`];
        case "copy_path":
        case "rename_path":
            return [`file:${sourcePath ?? "*"}`, `file:${targetPath ?? "*"}`];
        case "shell_execute":
            return ["shell:*"];
        default:
            return [`tool:${toolCall.name}`];
    }
}

export async function runWithToolLocks<T>(keys: string[], task: () => Promise<T>): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();
    const run = (index: number): Promise<T> => {
        const key = uniqueKeys[index];
        if (!key) return task();
        return toolResourceLocks.runExclusive(key, () => run(index + 1));
    };

    return run(0);
}

export async function executeScheduledTool(
    userId: number | undefined | null,
    toolCall: ToolCallData,
    message: TelegramStreamMessage,
    context: ToolRuntimeContext,
): Promise<string> {
    const keys = toolResourceKeys(toolCall);
    if (!keys.length) return executeTool(userId, toolCall, message, context);
    return runWithToolLocks(keys, () => executeTool(userId, toolCall, message, context));
}

export async function executeToolBatch(
    userId: number | undefined | null,
    toolCalls: ToolCallData[],
    message: TelegramStreamMessage,
    context: ToolRuntimeContext,
    memory: ToolExecutionMemory = new Map(),
): Promise<string[]> {
    if (!toolCalls.length) return [];

    const statusCalls = dedupeToolCalls(toolCalls);

    const startedAt = Date.now();

    aiLog("info", "tool.batch.start", {
        count: toolCalls.length,
        uniqueCount: statusCalls.length,
        tools: statusCalls.map(aiLogToolCall),
    });

    message.setStatus(Environment.getUseToolText(statusCalls));
    await message.flush();

    const inBatch = new Map<string, Promise<string>>();

    const runOne = async (toolCall: ToolCallData): Promise<string> => {
        const signature = toolCallSignature(toolCall);
        const previous = memory.get(signature);

        if (previous && previous.count >= MAX_IDENTICAL_TOOL_CALLS) {
            const suppressed = duplicateToolCallSuppressedResult(toolCall, previous.result);

            aiLog("warn", "tool.duplicate.suppressed", {
                tool: aiLogToolCall(toolCall),
                previousCount: previous.count,
            });

            return suppressed;
        }

        message.setStatus(Environment.getUseToolText(statusCalls));
        await message.flush();

        const resultText = await executeScheduledTool(userId, toolCall, message, context);

        memory.set(signature, {
            count: (previous?.count ?? 0) + 1,
            result: resultText,
        });

        message.setStatus(Environment.getUseToolText(statusCalls));
        await message.flush();

        return resultText;
    };

    try {
        const results = await Promise.all(toolCalls.map(toolCall => {
            const signature = toolCallSignature(toolCall);
            const existing = inBatch.get(signature);

            if (existing) {
                aiLog("warn", "tool.duplicate.in_batch_joined", {
                    tool: aiLogToolCall(toolCall),
                });

                return existing;
            }

            const promise = runOne(toolCall);
            inBatch.set(signature, promise);
            return promise;
        }));

        message.setStatus(Environment.getUseToolText(statusCalls));
        await message.flush();

        const finishedAt = new Date().toISOString();
        await Promise.all(results.map(async (resultText, index) => {
            const toolCall = toolCalls[index];
            if (!toolCall) return;

            message.recordToolExecution({
                toolName: toolCall.name,
                callId: toolCall.id,
                argumentsText: toolCall.argumentsText,
                resultChars: resultText.length,
                startedAt: new Date(startedAt).toISOString(),
                finishedAt,
            });

            try {
                const attachment = await persistToolResultArtifactAttachment({
                    toolCall,
                    resultText,
                    chatId: message.sourceChatId(),
                    messageId: message.sourceMessageId(),
                });
                await message.storeInternalAttachment(attachment);
            } catch (error) {
                logError(error instanceof Error ? error : String(error));
            }
        }));

        aiLog("success", "tool.batch.done", {
            count: toolCalls.length,
            uniqueCount: statusCalls.length,
            duration: aiLogDuration(startedAt),
        });

        return results;
    } catch (e) {
        aiLog("error", "tool.batch.failed", {
            count: toolCalls.length,
            duration: aiLogDuration(startedAt),
            error: e instanceof Error ? e : String(e),
        });

        throw e;
    }
}

export function appendOllamaToolResults(messages: ChatMessage[], calls: ToolCallData[], results: string[]): void {
    for (const [index, call] of calls.entries()) {
        messages.push({
            role: "tool",
            content: results[index] ?? "",
            tool_name: call.name
        });
    }
}

export function stringifyToolExecutionResult(result: BoundaryValue): string {
    if (typeof result === "string") return result;
    const json = JSON.stringify(toJsonValue(result) ?? String(result));
    return json ?? String(result);
}

export type ToolExecutionMemory = Map<string, { count: number; result: string }>;

export function stableJsonStringify(value: BoundaryValue): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableJsonStringify).join(",")}]`;
    }

    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
            .join(",")}}`;
    }

    return JSON.stringify(value);
}

export function toolCallSignature(toolCall: ToolCallData): string {
    const parsed = parseToolArgumentsObject(toolCall.argumentsText);
    const argsSignature = parsed.ok
        ? stableJsonStringify(parsed.args)
        : `invalid-json:${toolCall.argumentsText}`;

    return `${toolCall.name}\u0000${argsSignature}`;
}

export type StreamingToolCallChunkLike = {
    id?: string;
    index?: number;
    name?: string;
    function?: {
        name?: string;
        arguments?: string | JsonObject;
    };
    arguments?: string | JsonObject;
};

export class StreamingToolCallAccumulator {
    private readonly byKey = new Map<string, ToolCallData>();

    constructor(
        private readonly prefix: string,
        private readonly round: number,
    ) {
    }

    add(chunks: readonly StreamingToolCallChunkLike[]): ToolCallData[] {
        for (const [fallbackIndex, chunk] of chunks.entries()) {
            const key = typeof chunk.index === "number"
                ? `index:${chunk.index}`
                : chunk.id
                    ? `id:${chunk.id}`
                    : `fallback:${fallbackIndex}`;

            const existing = this.byKey.get(key) ?? {
                id: chunk.id ?? `${this.prefix}_${this.round}_${fallbackIndex}`,
                name: "",
                argumentsText: "",
            };

            if (chunk.id) {
                existing.id = chunk.id;
            }

            const name = chunk.function?.name ?? chunk.name;
            if (name) {
                existing.name = name;
            }

            const args = chunk.function?.arguments ?? chunk.arguments;
            if (typeof args === "string") {
                existing.argumentsText += args;
            } else if (args !== undefined) {
                existing.argumentsText = JSON.stringify(args);
            }

            this.byKey.set(key, existing);
        }

        return this.snapshot();
    }

    snapshot(): ToolCallData[] {
        return [...this.byKey.values()].filter(call => call.name);
    }
}

export function duplicateToolCallSuppressedResult(toolCall: ToolCallData, previousResult: string): string {
    return JSON.stringify({
        success: false,
        skipped: true,
        reason: `Identical tool call '${toolCall.name}' with the same arguments was already executed in this agentic loop. Use the previous result and answer the user instead of calling the tool again.`,
        previousResult: previousResult.slice(0, 8000),
    });
}

export function dedupeToolCalls(calls: ToolCallData[]): ToolCallData[] {
    const bySignature = new Map<string, ToolCallData>();

    for (const call of calls) {
        bySignature.set(toolCallSignature(call), call);
    }

    return [...bySignature.values()];
}

export type NormalizedRouterPlanStep = {
    t: string[]; // Tool name
    h: string; // Hint
    from: string;
};

export type NormalizedRouterPlan = {
    s: NormalizedRouterPlanStep[]; // Steps
    m: string; // Missing
};

export function toolSchemaName(tool: BoundaryValue): string | undefined {
    if (!isRecord(tool)) return undefined;
    const fn = isRecord(tool.function) ? tool.function : undefined;
    const directName = fn?.name ?? tool.name ?? (typeof tool.type === "string" && tool.type !== "function" ? tool.type : undefined);
    return asOptionalString(directName);
}

export function toolSchemaNames(tool: BoundaryValue): string[] {
    if (!isRecord(tool)) return [];

    if (Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations
            .map(declaration => isRecord(declaration) ? asOptionalString(declaration.name) : undefined)
            .filter((name): name is string => !!name);
    }

    const name = toolSchemaName(tool);
    return name ? [name] : [];
}

export function allToolSchemaNames(tools: readonly BoundaryValue[]): string[] {
    return [...new Set(tools.flatMap(toolSchemaNames))];
}

export function getOpenAIResponsesToolsWithImage(
    config: RuntimeConfigSnapshot,
    forCreator?: boolean,
    vectorStoreIds: string[] = [],
): Array<OpenAiResponseTool | LooseRecord> {
    const tools: Array<OpenAiResponseTool | LooseRecord> = [
        ...getOpenAIResponsesTools(forCreator),
        getOpenAICodeInterpreterTool(),
        {
            type: "image_generation",
            model: config.openAiImageTarget.model,
            size: "auto",
            moderation: "low",
            output_format: "png",
            partial_images: OPENAI_IMAGE_PARTIALS,
        },
        {type: "web_search"},
    ];

    if (vectorStoreIds.length) {
        tools.unshift({
            type: "file_search",
            vector_store_ids: vectorStoreIds,
        });
    }

    return tools;
}

export function collectOpenAiResponseText(response: OpenAiResponseLike): string {
    if (typeof response.output_text === "string") return response.output_text;

    return (response.output ?? [])
        .filter(item => item.type === "message")
        .flatMap(item => item.content ?? [])
        .map(content => content.text ?? content.refusal ?? "")
        .join("");
}

export function collectOpenAiResponseFunctionCalls(response: OpenAiResponseLike): OpenAiResponsesFunctionCall[] {
    return (response.output ?? [])
        .filter(item => item.type === "function_call" && item.call_id && item.name)
        .map(item => ({
            callId: item.call_id!,
            name: item.name!,
            argumentsText: item.arguments ?? "{}",
        }));
}

export type OpenAiCodeInterpreterCall = {
    id: string;
    code: string | null;
    containerId: string;
    status: string;
    outputs: Array<{ type?: "logs" | "image"; logs?: string; url?: string }>;
};

export function collectOpenAiResponseCodeInterpreterCalls(response: OpenAiResponseLike): OpenAiCodeInterpreterCall[] {
    return (response.output ?? [])
        .filter(item => item.type === "code_interpreter_call" && item.id && item.container_id)
        .map(item => ({
            id: item.id!,
            code: item.code ?? null,
            containerId: item.container_id!,
            status: item.status ?? "unrecognized",
            outputs: Array.isArray(item.outputs) ? item.outputs : [],
        }));
}

export function collectOpenAiResponseImages(response: OpenAiResponseLike): string[] {
    return (response.output ?? [])
        .filter(item => item.type === "image_generation_call" && typeof item.result === "string")
        .map(item => item.result!);
}

export function writeOpenAiGeneratedImage(sourceMessage: Message, b64: string, label: string): {
    buffer: Buffer;
    cachePath: string;
    fileName: string;
} {
    const buffer = Buffer.from(b64, "base64");
    const fileName = `${sourceMessage.chat.id}_${sourceMessage.message_id}_${Date.now()}_${label}.png`;
    const cachePath = path.join(photoGenDir(), fileName);
    fs.writeFileSync(cachePath, buffer);
    return {buffer, cachePath, fileName};
}

export async function showOpenAiGeneratedImage(
    streamMessage: TelegramStreamMessage,
    sourceMessage: Message,
    b64: string,
    label: string,
    status: string,
    final: boolean,
): Promise<void> {
    const image = writeOpenAiGeneratedImage(sourceMessage, b64, label);
    const attachment: StoredAttachment = {
        kind: "image",
        fileId: image.cachePath,
        fileName: image.fileName,
        mimeType: "image/png",
        cachePath: image.cachePath,
    };
    if (final && !streamMessage.getText().trim()) {
        streamMessage.replaceText(status);
        streamMessage.clearStatus();
    } else {
        streamMessage.setStatus(status);
    }
    await streamMessage.showImage(image.buffer, attachment);
}

export function openAiResponseItemCallId(item: OpenAiResponseOutputItem & { id?: string }): string {
    return item.call_id ?? item.id ?? `openai_response_${Date.now()}`;
}

