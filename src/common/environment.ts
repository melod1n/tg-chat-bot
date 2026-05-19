import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {parse as parseDotEnv} from "dotenv";
import {z} from "zod";
import {appLogger} from "../logging/logger.js";
import type {BoundaryValue, ErrorLike} from "./boundary-types";

import {Answers} from "../model/answers.js";
import {AiProvider} from "../model/ai-provider.js";
import {ImageHandleFallbackPolicy, ImageHandlePolicy, RateLimitFallbackPolicy} from "./policies.js";
import {ToolRankerFallbackPolicy} from "./policies.js";
import type {ToolCallData} from "../ai/unified-ai-runner.js";
import {PYTHON_INTERPRETER_TOOL_NAME} from "../ai/tools/python-interpretator.js";
import {Localization, type LocalizationParams} from "./localization.js";

function parseBooleanLike(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return ["true", "t", "y", "1"].includes(normalized);
}

type EnvRecord = Record<string, string>;
type StringEnumLike = Record<string, string>;
type StringEnumValue<T extends StringEnumLike> = T[keyof T];

function normalizeString(value: BoundaryValue): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

const optionalStringSchema = z
    .preprocess(normalizeString, z.string().optional())
    .optional()
    .catch(undefined);

function stringWithDefaultSchema(defaultValue: string) {
    return z
        .preprocess(value => {
            const normalized = normalizeString(value as BoundaryValue);
            return normalized ?? defaultValue;
        }, z.string())
        .default(defaultValue)
        .catch(defaultValue);
}

function booleanWithDefaultSchema(defaultValue: boolean) {
    return z
        .preprocess(value => {
            const normalized = normalizeString(value as BoundaryValue);

            if (normalized === undefined) {
                return defaultValue;
            }

            return parseBooleanLike(normalized);
        }, z.boolean())
        .default(defaultValue)
        .catch(defaultValue);
}

const optionalBooleanSchema = z
    .preprocess(value => {
        const normalized = normalizeString(value as BoundaryValue);
        return normalized === undefined ? undefined : parseBooleanLike(normalized);
    }, z.boolean().optional())
    .optional()
    .catch(undefined);

function requiredStringSchema() {
    return z
        .preprocess(normalizeString, z.string().min(1));
}

function requiredPositiveIntSchema() {
    return z
        .preprocess(value => {
            const normalized = normalizeString(value as BoundaryValue);

            if (normalized === undefined) {
                return undefined;
            }

            const number = Number(normalized);

            if (!Number.isSafeInteger(number) || number <= 0) {
                return undefined;
            }

            return number;
        }, z.number().int().positive());
}

function numberWithDefaultSchema(defaultValue: number) {
    return z
        .preprocess(value => {
            const normalized = normalizeString(value as BoundaryValue);

            if (normalized === undefined) {
                return defaultValue;
            }

            const number = Number(normalized);
            return Number.isFinite(number) ? number : defaultValue;
        }, z.number())
        .default(defaultValue)
        .catch(defaultValue);
}

function positiveIntWithDefaultSchema(defaultValue: number) {
    return z
        .preprocess(value => {
            const normalized = normalizeString(value as BoundaryValue);

            if (normalized === undefined) {
                return defaultValue;
            }

            const number = Number(normalized);

            if (!Number.isSafeInteger(number) || number <= 0) {
                return defaultValue;
            }

            return number;
        }, z.number().int().positive())
        .default(defaultValue)
        .catch(defaultValue);
}

function enumWithDefaultSchema<T extends StringEnumLike>(
    enumObject: T,
    defaultValue: StringEnumValue<T>,
) {
    const values = Object.values(enumObject) as StringEnumValue<T>[];

    return z
        .preprocess(value => {
            const normalized = normalizeString(value as BoundaryValue);

            if (normalized === undefined) {
                return defaultValue;
            }

            return values.includes(normalized as StringEnumValue<T>)
                ? normalized
                : defaultValue;
        }, z.custom<StringEnumValue<T>>((value): value is StringEnumValue<T> => {
            return typeof value === "string"
                && values.includes(value as StringEnumValue<T>);
        }))
        .default(defaultValue)
        .catch(defaultValue);
}

const StartupEnvSchema = z.object({
    BOT_TOKEN: requiredStringSchema(),
    DATABASE_URL: optionalStringSchema,
    DB_PATH: optionalStringSchema,
    DATA_PATH: optionalStringSchema,
    TEST_ENVIRONMENT: booleanWithDefaultSchema(false),
    IS_DOCKER: optionalBooleanSchema,
});

const RuntimeEnvSchema = z.object({
    CREATOR_ID: requiredPositiveIntSchema(),
    BOT_PREFIX: stringWithDefaultSchema(""),
    CHAT_IDS_WHITELIST: optionalStringSchema,
    ONLY_FOR_CREATOR_MODE: booleanWithDefaultSchema(false),
    ENABLE_UNSAFE_EVAL: booleanWithDefaultSchema(false),
    MAX_PHOTO_SIZE: positiveIntWithDefaultSchema(1280),
    PROCESS_LINKS: booleanWithDefaultSchema(false),
    LOCALES_DIR: stringWithDefaultSchema("locales"),

    RATE_LIMIT_FALLBACK_POLICY: enumWithDefaultSchema(
        RateLimitFallbackPolicy,
        RateLimitFallbackPolicy.NOTIFY_USER,
    ),

    IMAGE_HANDLE_POLICY: enumWithDefaultSchema(
        ImageHandlePolicy,
        ImageHandlePolicy.HANDLE_IF_CAPABLE,
    ),

    IMAGE_HANDLE_FALLBACK_POLICY: enumWithDefaultSchema(
        ImageHandleFallbackPolicy,
        ImageHandleFallbackPolicy.NOTIFY_USER,
    ),

    TOOL_RANKER_FALLBACK_POLICY: enumWithDefaultSchema(
        ToolRankerFallbackPolicy,
        ToolRankerFallbackPolicy.ALL_TOOLS,
    ),

    BRAVE_SEARCH_API_KEY: optionalStringSchema,
    OPEN_WEATHER_MAP_API_KEY: optionalStringSchema,

    FILE_TOOLS_ROOT_DIR: optionalStringSchema,
    ENABLE_FS_TOOLS: optionalBooleanSchema,

    DEFAULT_AI_PROVIDER: enumWithDefaultSchema(
        AiProvider,
        AiProvider.OLLAMA,
    ),

    SYSTEM_PROMPT: optionalStringSchema,
    RANKER_TOOL_PROMPT: optionalStringSchema,
    USE_NAMES_IN_PROMPT: booleanWithDefaultSchema(false),
    USE_SYSTEM_PROMPT: booleanWithDefaultSchema(true),

    SEND_TIME_TOOK: optionalBooleanSchema,

    ENABLE_PYTHON_INTERPRETER: optionalBooleanSchema,
    DISABLE_LOCAL_TOOLS: optionalBooleanSchema,
    LOCAL_TOOL_ALLOWLIST: optionalStringSchema,
    LOCAL_TOOL_DENYLIST: optionalStringSchema,
    MCP_SERVERS: optionalStringSchema,

    OLLAMA_API_KEY: optionalStringSchema,
    OLLAMA_ADDRESS: optionalStringSchema,
    OLLAMA_CHAT_MODEL: stringWithDefaultSchema("gemma4:e4b"),
    OLLAMA_IMAGE_MODEL: optionalStringSchema,
    OLLAMA_THINK_MODEL: optionalStringSchema,
    OLLAMA_AUDIO_MODEL: optionalStringSchema,
    OLLAMA_EMBEDDING_MODEL: stringWithDefaultSchema("nomic-embed-text:latest"),
    OLLAMA_RAG_CHUNK_SIZE: positiveIntWithDefaultSchema(1400),
    OLLAMA_RAG_CHUNK_OVERLAP: positiveIntWithDefaultSchema(220),
    OLLAMA_RAG_TOP_K: positiveIntWithDefaultSchema(8),
    OLLAMA_RAG_MAX_CONTEXT_CHARS: positiveIntWithDefaultSchema(14000),
    OLLAMA_RAG_MIN_SCORE: numberWithDefaultSchema(0.12),
    OLLAMA_RAG_MAX_ARCHIVE_FILES: positiveIntWithDefaultSchema(200),
    OLLAMA_RAG_MAX_ARCHIVE_BYTES: positiveIntWithDefaultSchema(50 * 1024 * 1024),
    OLLAMA_RAG_MAX_ARCHIVE_DEPTH: positiveIntWithDefaultSchema(2),
    OLLAMA_MAX_CONCURRENT_REQUESTS: positiveIntWithDefaultSchema(1),

    MISTRAL_API_KEY: optionalStringSchema,
    MISTRAL_MODEL: stringWithDefaultSchema("mistral-tiny-latest"),
    MISTRAL_TRANSCRIPTION_MODEL: stringWithDefaultSchema("voxtral-mini-latest"),
    MISTRAL_TTS_MODEL: stringWithDefaultSchema("voxtral-mini-tts-latest"),
    MISTRAL_TTS_VOICE_ID: stringWithDefaultSchema("cb891218-482c-4392-9878-91e8d999d57a"),
    MISTRAL_MAX_CONCURRENT_REQUESTS: positiveIntWithDefaultSchema(3),

    OPENAI_BASE_URL: optionalStringSchema,
    OPENAI_API_KEY: optionalStringSchema,
    OPENAI_MODEL: stringWithDefaultSchema("gpt-4.1-nano"),
    OPENAI_IMAGE_MODEL: stringWithDefaultSchema("gpt-image-1-mini"),
    OPENAI_TRANSCRIPTION_MODEL: stringWithDefaultSchema("gpt-4o-mini-transcribe"),
    OPENAI_TTS_MODEL: stringWithDefaultSchema("gpt-4o-mini-tts"),
    OPENAI_TTS_VOICE: stringWithDefaultSchema("alloy"),
    OPENAI_TTS_INSTRUCTIONS: optionalStringSchema,
    OPENAI_MAX_CONCURRENT_REQUESTS: positiveIntWithDefaultSchema(3),
});

type StartupEnv = z.infer<typeof StartupEnvSchema>;
type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export class Environment {
    private static readonly ENV_FILE_PATH = path.resolve(".env");

    private static lastEnvMtimeMs: number | undefined;
    private static lastSystemPromptMtimeMs: number | undefined;
    private static lastRankerToolPromptMtimeMs: number | undefined;
    private static envSystemPrompt: string | undefined;
    private static envRankerToolPrompt: string | undefined;

    static BOT_TOKEN: string = "";
    static TEST_ENVIRONMENT: boolean = false;
    static ADMIN_IDS: Set<number> = new Set<number>();
    static MUTED_IDS: Set<number> = new Set<number>();
    static CHAT_IDS_WHITELIST: Set<number> = new Set<number>();
    static BOT_PREFIX: string = "";
    static CREATOR_ID: number = 0;
    static IS_DOCKER: boolean = false;
    static DATA_PATH: string = "data";
    static DB_FILE_NAME: string = "database.db";
    static DB_PATH: string = "file:" + path.join(Environment.DATA_PATH, Environment.DB_FILE_NAME);
    static DB_FILE_PATH?: string;
    static DB_KIND: "sqlite" | "postgres" = "sqlite";

    static ONLY_FOR_CREATOR_MODE: boolean = false;

    static ENABLE_UNSAFE_EVAL: boolean = false;

    static ANSWERS: Answers;

    static MAX_PHOTO_SIZE: number = 0;

    static PROCESS_LINKS: boolean = false;
    static LOCALES_DIR: string = "locales";

    static RATE_LIMIT_FALLBACK_POLICY: RateLimitFallbackPolicy = RateLimitFallbackPolicy.NOTIFY_USER;
    static IMAGE_HANDLE_POLICY: ImageHandlePolicy = ImageHandlePolicy.HANDLE_IF_CAPABLE;
    static IMAGE_HANDLE_FALLBACK_POLICY: ImageHandleFallbackPolicy = ImageHandleFallbackPolicy.NOTIFY_USER;
    static TOOL_RANKER_FALLBACK_POLICY: ToolRankerFallbackPolicy = ToolRankerFallbackPolicy.ALL_TOOLS;

    static BRAVE_SEARCH_API_KEY?: string;
    static OPEN_WEATHER_MAP_API_KEY?: string;

    static FILE_TOOLS_ROOT_DIR?: string;
    static ENABLE_FS_TOOLS: boolean = false;

    // AI Stuff
    static DEFAULT_AI_PROVIDER: AiProvider = AiProvider.OLLAMA;

    static SYSTEM_PROMPT?: string;
    static RANKER_TOOL_PROMPT?: string;
    static USE_NAMES_IN_PROMPT: boolean = false;
    static USE_SYSTEM_PROMPT: boolean = true;
    static SEND_TIME_TOOK: boolean = false;

    static ENABLE_PYTHON_INTERPRETER: boolean = false;
    static DISABLE_LOCAL_TOOLS: boolean = false;
    static LOCAL_TOOL_ALLOWLIST?: string;
    static LOCAL_TOOL_DENYLIST?: string;
    static MCP_SERVERS?: string;

    static OLLAMA_API_KEY?: string;
    static OLLAMA_ADDRESS?: string;
    static OLLAMA_CHAT_MODEL: string = "";
    static OLLAMA_IMAGE_MODEL: string = Environment.OLLAMA_CHAT_MODEL;
    static OLLAMA_THINK_MODEL: string = Environment.OLLAMA_CHAT_MODEL;
    static OLLAMA_AUDIO_MODEL: string = Environment.OLLAMA_CHAT_MODEL;
    static OLLAMA_EMBEDDING_MODEL: string = "";
    static OLLAMA_RAG_CHUNK_SIZE: number = 0;
    static OLLAMA_RAG_CHUNK_OVERLAP: number = 0;
    static OLLAMA_RAG_TOP_K: number = 0;
    static OLLAMA_RAG_MAX_CONTEXT_CHARS: number = 0;
    static OLLAMA_RAG_MIN_SCORE: number = 0.0;
    static OLLAMA_RAG_MAX_ARCHIVE_FILES: number = 0;
    static OLLAMA_RAG_MAX_ARCHIVE_BYTES: number = 0;
    static OLLAMA_RAG_MAX_ARCHIVE_DEPTH: number = 0;
    static OLLAMA_MAX_CONCURRENT_REQUESTS: number = 0;

    static MISTRAL_API_KEY?: string;
    static MISTRAL_MODEL: string = "";
    static MISTRAL_TRANSCRIPTION_MODEL: string = "";
    static MISTRAL_TTS_MODEL: string = "";
    static MISTRAL_TTS_VOICE_ID: string = "";
    static MISTRAL_MAX_CONCURRENT_REQUESTS: number = 0;

    static OPENAI_BASE_URL?: string;
    static OPENAI_API_KEY?: string;
    static OPENAI_MODEL: string = "";
    static OPENAI_IMAGE_MODEL: string = "";
    static OPENAI_TRANSCRIPTION_MODEL: string = "";
    static OPENAI_TTS_MODEL: string = "";
    static OPENAI_TTS_VOICE: string = "";
    static OPENAI_TTS_INSTRUCTIONS?: string;
    static OPENAI_MAX_CONCURRENT_REQUESTS: number = 0;

    static get databaseSummaryText(): string {
        if (this.DB_KIND === "postgres") {
            return "postgres";
        }

        if (this.DB_FILE_PATH) {
            return `sqlite:${this.DB_FILE_PATH}`;
        }

        if (this.DB_PATH === ":memory:") {
            return "sqlite:memory";
        }

        return this.DB_PATH.startsWith("file:") ? "sqlite:file" : "sqlite";
    }

    private static text(key: string, fallback: string, params: LocalizationParams = {}): string {
        return Localization.text(key, params, fallback);
    }

    private static textArray(key: string, fallback: string[], params: LocalizationParams = {}): string[] {
        return Localization.textArray(key, params, fallback);
    }

    static get errorText() {
        return this.text("errorText", "⚠️ An error occurred.");
    }

    static get waitThinkText() {
        return this.text("waitThinkText", "⏳ Let me think...");
    }

    static get analyzingPictureText() {
        return this.text("analyzingPictureText", "🔍 Analyzing the image...");
    }

    static get analyzingPicturesText() {
        return this.text("analyzingPicturesText", "🔍 Analyzing the images...");
    }

    static get reasoningText() {
        return this.text("reasoningText", "🤔 Reasoning...");
    }

    static get transcribingAudioText() {
        return this.text("transcribingAudioText", "🦻 Transcribing audio...");
    }

    static get genImageText() {
        return this.text("genImageText", "👨‍🎨 Generating an image...");
    }

    static get cancelText() {
        return this.text("cancelText", "❌ Cancel");
    }

    static get regenerateText() {
        return this.text("regenerateText", "🔄 Regenerate");
    }

    static get aiCancelCallbackText() {
        return this.text("aiCancelCallbackText", "Cancel AI generation");
    }

    static get aiRegenerateCallbackText() {
        return this.text("aiRegenerateCallbackText", "Regenerate AI response");
    }

    static get userSettingsCallbackText() {
        return this.text("userSettingsCallbackText", "User settings");
    }

    static get noAccessText() {
        return this.text("noAccessText", "No access");
    }

    static get notBotCreatorText() {
        return this.text("notBotCreatorText", "You are not the bot creator.");
    }

    static get notBotAdministratorText() {
        return this.text("notBotAdministratorText", "You are not a bot administrator.");
    }

    static get notAChatText() {
        return this.text("notAChatText", "This is not a chat.");
    }

    static get notChatAdministratorText() {
        return this.text("notChatAdministratorText", "You are not a chat administrator.");
    }

    static get botNotChatAdministratorText() {
        return this.text("botNotChatAdministratorText", "The bot is not a chat administrator.");
    }

    static get replyRequiredText() {
        return this.text("replyRequiredText", "A reply to a message is required.");
    }

    static get onlyOriginalAuthorText() {
        return this.text("onlyOriginalAuthorText", "Only the author of the original message can perform this action.");
    }

    static get dockerContainerLabelText() {
        return this.text("dockerContainerLabelText", "Docker container");
    }

    static get processLabelText() {
        return this.text("processLabelText", "Process");
    }

    static get systemLabelText() {
        return this.text("systemLabelText", "System");
    }

    static get systemInfoOsLabelText() {
        return this.text("systemInfoOsLabelText", "OS");
    }

    static get systemInfoRuntimeLabelText() {
        return this.text("systemInfoRuntimeLabelText", "RUNTIME");
    }

    static get systemInfoDockerLabelText() {
        return this.text("systemInfoDockerLabelText", "DOCKER");
    }

    static get systemInfoCpuLabelText() {
        return this.text("systemInfoCpuLabelText", "CPU");
    }

    static get systemInfoRamLabelText() {
        return this.text("systemInfoRamLabelText", "RAM");
    }

    static get systemInfoCpuCoresText() {
        return this.text("systemInfoCpuCoresText", "cores");
    }

    static get systemInfoCpuThreadsText() {
        return this.text("systemInfoCpuThreadsText", "threads");
    }

    static get idChatLabelText() {
        return this.text("idChatLabelText", "chat id");
    }

    static get idFromLabelText() {
        return this.text("idFromLabelText", "from id");
    }

    static get idReplyLabelText() {
        return this.text("idReplyLabelText", "reply id");
    }

    static get runtimeProviderLabelText() {
        return this.text("runtimeProviderLabelText", "provider");
    }

    static get runtimeProviderCurrentLabelText() {
        return this.text("runtimeProviderCurrentLabelText", "current");
    }

    static get runtimeModelLabelText() {
        return this.text("runtimeModelLabelText", "model");
    }

    static get runtimeCapabilitiesLabelText() {
        return this.text("runtimeCapabilitiesLabelText", "capabilities");
    }

    static get runtimeExternalLabelText() {
        return this.text("runtimeExternalLabelText", "external");
    }

    static get runtimeCapabilityChatText() {
        return this.text("runtimeCapabilityChatText", "chat");
    }

    static get runtimeCapabilityVisionText() {
        return this.text("runtimeCapabilityVisionText", "vision / image input");
    }

    static get runtimeCapabilityOcrText() {
        return this.text("runtimeCapabilityOcrText", "ocr");
    }

    static get runtimeCapabilityThinkingText() {
        return this.text("runtimeCapabilityThinkingText", "thinking / reasoning");
    }

    static get runtimeCapabilityExtendedThinkingText() {
        return this.text("runtimeCapabilityExtendedThinkingText", "leveled thinking / reasoning");
    }

    static get runtimeCapabilityToolsText() {
        return this.text("runtimeCapabilityToolsText", "tools / function calling");
    }

    static get runtimeCapabilityAudioText() {
        return this.text("runtimeCapabilityAudioText", "audio input");
    }

    static get runtimeCapabilitySpeechToTextText() {
        return this.text("runtimeCapabilitySpeechToTextText", "speech-to-text");
    }

    static get runtimeCapabilityTextToSpeechText() {
        return this.text("runtimeCapabilityTextToSpeechText", "text-to-speech");
    }

    static get runtimeCapabilityDocumentsText() {
        return this.text("runtimeCapabilityDocumentsText", "documents / rag");
    }

    static get runtimeCapabilityOutputImagesText() {
        return this.text("runtimeCapabilityOutputImagesText", "image gen / image output");
    }

    static get infoAiBlockLabelText() {
        return this.text("infoAiBlockLabelText", "AI");
    }

    static get infoSupportedProvidersLabelText() {
        return this.text("infoSupportedProvidersLabelText", "providers");
    }

    static get infoToolsBlockLabelText() {
        return this.text("infoToolsBlockLabelText", "tools");
    }

    static get infoCommandsBlockLabelText() {
        return this.text("infoCommandsBlockLabelText", "commands");
    }

    static get infoPublicLabelText() {
        return this.text("infoPublicLabelText", "public");
    }

    static get infoPrivateLabelText() {
        return this.text("infoPrivateLabelText", "private");
    }

    static get infoChatLabelText() {
        return this.text("infoChatLabelText", "chat");
    }

    static get infoCallbackLabelText() {
        return this.text("infoCallbackLabelText", "callback");
    }

    static get commandsHeaderText() {
        return this.text("commandsHeaderText", "Commands:\n\n");
    }

    static get sentCommandsInDmText() {
        return this.text("sentCommandsInDmText", "Sent commands in DM 😎");
    }

    static get couldNotSendCommandsInDmText() {
        return this.text("couldNotSendCommandsInDmText", "Could not send commands in DM ☹️\nSending them here instead");
    }

    static get administratorsHeaderText() {
        return this.text("administratorsHeaderText", "*Administrators*:\n\n");
    }

    static get noUserInfoText() {
        return this.text("noUserInfoText", "No user information");
    }

    static get useLeaveCommandText() {
        return this.text("useLeaveCommandText", "Use /leave");
    }

    static get databaseBackupCaption() {
        return this.text("databaseBackupCaption", "Database backup");
    }

    static get databaseBackupSentText() {
        return this.text("databaseBackupSentText", "Successfully sent to the creator in DM!");
    }

    static get databaseImportDoneText() {
        return this.text("databaseImportDoneText", "Database imported successfully.");
    }

    static get databaseImportNeedJsonText() {
        return this.text("databaseImportNeedJsonText", "Send a JSON backup file or pass JSON after /importdb.");
    }

    static get noChoicesText() {
        return this.text("noChoicesText", "Nothing to choose from");
    }

    static get qrCodeMissingTextText() {
        return this.text("qrCodeMissingTextText", "No text found for QR code generation.");
    }

    static get quoteMissingTextText() {
        return this.text("quoteMissingTextText", "Could not find text in the message 😢");
    }

    static get quoteBuildFailedText() {
        return this.text("quoteBuildFailedText", "Could not build the quote 😢");
    }

    static get speechToTextInstructionText() {
        return this.text("speechToTextInstructionText", "Send audio/voice/video-note or reply with /stt to a message containing audio.");
    }

    static get speechToTextEmptyResultText() {
        return this.text("speechToTextEmptyResultText", "Speech-to-text did not return transcription text.");
    }

    static get textToSpeechInstructionText() {
        return this.text("textToSpeechInstructionText", "Send text after the command or reply with /tts to a message containing text.");
    }

    static get titleMissingText() {
        return this.text("titleMissingText", "Could not find a title...");
    }

    static get betterFallbackText() {
        return this.text("betterFallbackText", "Better");
    }

    static get pongText() {
        return this.text("pongText", "pong");
    }

    static get variableNotDefinedText() {
        return this.text("variableNotDefinedText", "variable is not defined");
    }

    static get evaluationVariableNotDefinedText() {
        return this.text("evaluationVariableNotDefinedText", "Variable not defined");
    }

    static get defaultTestAnswerText() {
        return this.text("defaultTestAnswerText", "a");
    }

    static get prefixFallbackText() {
        return this.text("prefixFallbackText", "?");
    }

    static get searchResultsHeaderText() {
        return this.text("searchResultsHeaderText", "Results:\n\n");
    }

    static get modelListHeaderText() {
        return this.text("modelListHeaderText", "Available models:\n\n");
    }

    static get modelListLoadFailedText() {
        return this.text("modelListLoadFailedText", "Could not load the model list");
    }

    static get noCurrentModelText() {
        return this.text("noCurrentModelText", "Model is not set. Use one of the listed values.");
    }

    static get unsupportedAttachmentText() {
        return this.text("unsupportedAttachmentText", "This attachment type is not supported.");
    }

    static get attachmentMissingFromCacheText() {
        return this.text("attachmentMissingFromCacheText", "Attachment file is missing from cache.");
    }

    static get couldNotIdentifyUserForSpeechToTextText() {
        return this.text("couldNotIdentifyUserForSpeechToTextText", "Could not identify the user for speech-to-text.");
    }

    static get missingTranscriptionFileText() {
        return this.text("missingTranscriptionFileText", "Unable to prepare the audio file for transcription.");
    }

    static get transcriptionFailedText() {
        return this.text("transcriptionFailedText", "Could not transcribe the audio.");
    }

    static get imageGenUnsupportedFilesText() {
        return this.text("imageGenUnsupportedFilesText", "Image generation does not support files in this mode.");
    }

    static get unsupportedDocumentProviderText() {
        return this.text("unsupportedDocumentProviderText", "This provider does not support attached documents.");
    }

    static get mistralPdfOnlyText() {
        return this.text("mistralPdfOnlyText", "Mistral currently supports only PDF documents.");
    }

    static get mistralDocumentUploadFailedText() {
        return this.text("mistralDocumentUploadFailedText", "Could not upload the document to Mistral.");
    }

    static get documentContentLabelText() {
        return this.text("documentContentLabelText", "Document content");
    }

    static get mistralLibraryIdMissingText() {
        return this.text("mistralLibraryIdMissingText", "Mistral did not return a temporary document library id.");
    }

    static get documentsUnifiedRunnerUnsupportedText() {
        return this.text("documentsUnifiedRunnerUnsupportedText", "Documents in the unified runner are currently handled only by Ollama RAG and Mistral.");
    }

    static get zipCentralDirectoryNotFoundText() {
        return this.text("zipCentralDirectoryNotFoundText", "ZIP archive is corrupted: central directory was not found.");
    }

    static get zipInvalidCentralDirectoryText() {
        return this.text("zipInvalidCentralDirectoryText", "ZIP archive is corrupted: invalid central directory.");
    }

    static get tarFileTooLargeText() {
        return this.text("tarFileTooLargeText", "TAR contains a file that is too large.");
    }

    static get tarInvalidEntrySizeText() {
        return this.text("tarInvalidEntrySizeText", "TAR archive is corrupted: invalid entry size.");
    }

    static get tarEntryExceedsBoundsText() {
        return this.text("tarEntryExceedsBoundsText", "TAR archive is corrupted: entry exceeds file bounds.");
    }

    static get docxDocumentXmlMissingText() {
        return this.text("docxDocumentXmlMissingText", "DOCX does not contain word/document.xml.");
    }

    static get localRagEmbeddingModelRequiredText() {
        return this.text("localRagEmbeddingModelRequiredText", "Local RAG requires OLLAMA_EMBEDDING_MODEL, for example nomic-embed-text.");
    }

    static get localRagChunksBuildFailedText() {
        return this.text("localRagChunksBuildFailedText", "Could not build chunks for local RAG.");
    }

    static get localRagNoSuitableFragmentsText() {
        return this.text("localRagNoSuitableFragmentsText", "Local RAG did not find suitable document fragments.");
    }

    static get unsupportedAiProviderText() {
        return this.text("unsupportedAiProviderText", "Unsupported AI provider.");
    }

    static get noSupportedTranscriptionProviderText() {
        return this.text("noSupportedTranscriptionProviderText", "No supported speech-to-text provider is configured.");
    }

    static get noSupportedTextToSpeechProviderText() {
        return this.text("noSupportedTextToSpeechProviderText", "No supported text-to-speech provider is configured.");
    }

    static get noSpeechToTextProviderForAccessText() {
        return this.text("noSpeechToTextProviderForAccessText", "No speech-to-text providers are configured for your access level.");
    }

    static get noTextToSpeechProviderForAccessText() {
        return this.text("noTextToSpeechProviderForAccessText", "No text-to-speech providers are configured for your access level.");
    }

    static get ollamaTextToSpeechUnsupportedText() {
        return this.text("ollamaTextToSpeechUnsupportedText", "Ollama does not support text-to-speech right now.");
    }

    static get ollamaSpeechToTextModelRequiredText() {
        return this.text("ollamaSpeechToTextModelRequiredText", "Ollama speech-to-text requires OLLAMA_AUDIO_MODEL=gemma4:e2b or OLLAMA_AUDIO_MODEL=gemma4:e4b.");
    }

    static get noTextToSynthesizeText() {
        return this.text("noTextToSynthesizeText", "No text to synthesize.");
    }

    static get pipelineFallbackGenericText() {
        return this.text("pipelineFallbackGenericText", "⚠️ I had to skip part of the request, but I can continue.");
    }

    static get pipelineFallbackNotifyText() {
        return this.text("pipelineFallbackNotifyText", "⚠️ I hit a problem and need to continue with a fallback.");
    }

    static get pipelineFallbackFailText() {
        return this.text("pipelineFallbackFailText", "⚠️ I could not finish this request.");
    }

    static get pipelineFallbackRagText() {
        return this.text("pipelineFallbackRagText", "⚠️ Document retrieval failed, so I will answer without RAG.");
    }

    static get pipelineFallbackSpeechToTextText() {
        return this.text("pipelineFallbackSpeechToTextText", "⚠️ Speech transcription failed, so I will continue without the audio transcript.");
    }

    static get pipelineFallbackTextToSpeechText() {
        return this.text("pipelineFallbackTextToSpeechText", "⚠️ Text-to-speech failed, so I will continue without audio output.");
    }

    static get pipelineFallbackToolText() {
        return this.text("pipelineFallbackToolText", "⚠️ Tool execution failed, so I will continue without that tool.");
    }

    static get mistralTtsNoAudioDataText() {
        return this.text("mistralTtsNoAudioDataText", "Mistral TTS did not return audioData.");
    }

    static get speechFileTooLargeText() {
        return this.text("speechFileTooLargeText", "The speech file is larger than 50 MB and cannot be sent.");
    }

    static get userSettingsTitle() {
        return this.text("userSettingsTitle", "User Settings");
    }

    static get userSettingsAiProviderSelectionTitle() {
        return this.text("userSettingsAiProviderSelectionTitle", "AI Provider Selection");
    }

    static get userSettingsInterfaceLanguageSelectionTitle() {
        return this.text("userSettingsInterfaceLanguageSelectionTitle", "Interface Language Selection");
    }

    static get userSettingsResponseLanguageSelectionTitle() {
        return this.text("userSettingsResponseLanguageSelectionTitle", "Response Language Selection");
    }

    static get userSettingsContextSizeSelectionTitle() {
        return this.text("userSettingsContextSizeSelectionTitle", "Context Size Selection");
    }

    static get userSettingsVoiceModeSelectionTitle() {
        return this.text("userSettingsVoiceModeSelectionTitle", "Voice Message Mode Selection");
    }

    static get userSettingsImageOutputSelectionTitle() {
        return this.text("userSettingsImageOutputSelectionTitle", "Image Output Mode Selection");
    }

    static get userSettingsTierLabel() {
        return this.text("userSettingsTierLabel", "Tier");
    }

    static get userSettingsAiProviderLabel() {
        return this.text("userSettingsAiProviderLabel", "AI provider");
    }

    static get userSettingsInterfaceLanguageLabel() {
        return this.text("userSettingsInterfaceLanguageLabel", "Interface language");
    }

    static get userSettingsResponseLanguageLabel() {
        return this.text("userSettingsResponseLanguageLabel", "LLM response language");
    }

    static get userSettingsContextSizeLabel() {
        return this.text("userSettingsContextSizeLabel", "Context size");
    }

    static get userSettingsVoiceModeLabel() {
        return this.text("userSettingsVoiceModeLabel", "Voice messages");
    }

    static get userSettingsImageOutputLabel() {
        return this.text("userSettingsImageOutputLabel", "Image output");
    }

    static get userSettingsBackButtonText() {
        return this.text("userSettingsBackButtonText", "Back");
    }

    static get userSettingsAiProviderButtonPrefix() {
        return this.text("userSettingsAiProviderButtonPrefix", "AI provider");
    }

    static get userSettingsInterfaceLanguageButtonPrefix() {
        return this.text("userSettingsInterfaceLanguageButtonPrefix", "Interface language");
    }

    static get userSettingsResponseLanguageButtonPrefix() {
        return this.text("userSettingsResponseLanguageButtonPrefix", "Response language");
    }

    static get userSettingsContextSizeButtonPrefix() {
        return this.text("userSettingsContextSizeButtonPrefix", "Context size");
    }

    static get userSettingsVoiceModeButtonPrefix() {
        return this.text("userSettingsVoiceModeButtonPrefix", "Voice messages");
    }

    static get userSettingsImageOutputButtonPrefix() {
        return this.text("userSettingsImageOutputButtonPrefix", "Image output");
    }

    static get userSettingsCreatorTierText() {
        return this.text("userSettingsCreatorTierText", "Creator");
    }

    static get userSettingsAdminTierText() {
        return this.text("userSettingsAdminTierText", "Admin");
    }

    static get userSettingsUserTierText() {
        return this.text("userSettingsUserTierText", "User");
    }

    static get userSettingsSelectedPrefix() {
        return this.text("userSettingsSelectedPrefix", "✓ ");
    }

    static get userSettingsContextSizeDefaultText() {
        return this.text("userSettingsContextSizeDefaultText", "Default");
    }

    static get userSettingsContextSizeMaxText() {
        return this.text("userSettingsContextSizeMaxText", "Max");
    }

    static get userSettingsVoiceModeExecuteText() {
        return this.text("userSettingsVoiceModeExecuteText", "Run through AI");
    }

    static get userSettingsVoiceModeTranscriptText() {
        return this.text("userSettingsVoiceModeTranscriptText", "Show transcript only");
    }

    static get userSettingsImageOutputPhotoText() {
        return this.text("userSettingsImageOutputPhotoText", "As photo");
    }

    static get userSettingsImageOutputDocumentText() {
        return this.text("userSettingsImageOutputDocumentText", "As document");
    }

    static commandTitles = {
        ae: "/ae",
        adminsAdd: "/addAdmin",
        adminsRemove: "/removeAdmin",
        ban: "/ban [reply]",
        choice: "/choice a, b, ..., c",
        coin: "/coin",
        debug: "/debug",
        aiRequests: "/aiRequests",
        aiAudit: "/aiAudit [reply|messageId|chatId messageId]",
        aiMetrics: "/aiMetrics",
        dice: "/dice",
        distort: "/distort [amp] [wavelength]",
        help: "/help",
        id: "/id",
        ignore: "/ignore",
        info: "/info",
        leave: "/leave",
        mistralChat: "/mistral",
        mistralGetModel: "/MistralGetModel",
        mistralListModels: "/MistralListModels",
        mistralSetModel: "/MistralSetModel",
        ollamaChat: "/ollama",
        ollamaGetModel: "/OllamaGetModel",
        ollamaListModels: "/OllamaListModels",
        ollamaSearch: "/search",
        ollamaSetModel: "/OllamaSetModel",
        openAiChat: "/openAI",
        openAiGetModel: "/OpenAIGetModel",
        openAiListModels: "/OpenAIListModels",
        openAiSetModel: "/OpenAISetModel",
        ping: "/ping",
        qr: "/qr",
        quote: "/quote",
        randomInt: "/randomInt",
        randomString: "/randomString",
        settings: "/settings",
        shutdown: "/shutdown",
        speechToText: "/stt",
        start: "/start",
        systemInfo: "/systemInfo",
        textToSpeech: "/tts",
        title: "/title",
        test: "test",
        transliteration: "/tr [text or reply]",
        unban: "/unban [reply]",
        unignore: "/unignore",
        uptime: "/uptime",
        whatBetter: "/what better [a] or [b]",
        when: "/when [value]",
    } as const;

    static get commandDescriptions() {
        return {
            ae: this.text("commandDescriptions.ae", "evaluation"),
            adminsAdd: this.text("commandDescriptions.adminsAdd", "Add user to admins"),
            adminsRemove: this.text("commandDescriptions.adminsRemove", "Remove user from admins"),
            ban: this.text("commandDescriptions.ban", "ban user from chat"),
            choice: this.text("commandDescriptions.choice", "Choose a random value"),
            coin: this.text("commandDescriptions.coin", "Heads or tails"),
            debug: this.text("commandDescriptions.debug", "Returns msg (or reply) as json"),
            aiRequests: this.text("commandDescriptions.aiRequests", "Show recent AI requests"),
            aiAudit: this.text("commandDescriptions.aiAudit", "Inspect AI request audit and artifacts"),
            aiMetrics: this.text("commandDescriptions.aiMetrics", "Show AI observability counters"),
            dice: this.text("commandDescriptions.dice", "Sends random or specific dice"),
            distort: this.text("commandDescriptions.distort", "Distortion of picture"),
            help: this.text("commandDescriptions.help", "Show list of commands"),
            id: this.text("commandDescriptions.id", "ID of chat, user and reply (if replied to any message)"),
            ignore: this.text("commandDescriptions.ignore", "Bot will ignore user"),
            info: this.text("commandDescriptions.info", "Info about bot"),
            leave: this.text("commandDescriptions.leave", "Bot will leave current chat"),
            mistralChat: this.text("commandDescriptions.mistralChat", "Chat with AI (Mistral)"),
            mistralGetModel: this.text("commandDescriptions.mistralGetModel", "Get current Mistral model"),
            mistralListModels: this.text("commandDescriptions.mistralListModels", "List all Mistral models"),
            mistralSetModel: this.text("commandDescriptions.mistralSetModel", "Set Mistral model"),
            ollamaChat: this.text("commandDescriptions.ollamaChat", "Chat with AI (Ollama)"),
            ollamaGetModel: this.text("commandDescriptions.ollamaGetModel", "Get current Ollama model"),
            ollamaListModels: this.text("commandDescriptions.ollamaListModels", "List all Ollama models"),
            ollamaSearch: this.text("commandDescriptions.ollamaSearch", "Web search via Ollama"),
            ollamaSetModel: this.text("commandDescriptions.ollamaSetModel", "Set Ollama model"),
            openAiChat: this.text("commandDescriptions.openAiChat", "Chat with AI (OpenAI)"),
            openAiGetModel: this.text("commandDescriptions.openAiGetModel", "Get current OpenAI model"),
            openAiListModels: this.text("commandDescriptions.openAiListModels", "List all OpenAI models"),
            openAiSetModel: this.text("commandDescriptions.openAiSetModel", "Set OpenAI model"),
            ping: this.text("commandDescriptions.ping", "Ping between received and sent message"),
            qr: this.text("commandDescriptions.qr", "Generates QR-code from text you sent or replied to."),
            quote: this.text("commandDescriptions.quote", "Make quote from text (or quote)"),
            randomInt: this.text("commandDescriptions.randomInt", "Ranged random integer from parameters"),
            randomString: this.text("commandDescriptions.randomString", "literally random string (up to 4096 symbols)"),
            settings: this.text("commandDescriptions.settings", "User settings"),
            shutdown: this.text("commandDescriptions.shutdown", "Self-destruction sequence for bot (shutdown)"),
            speechToText: this.text("commandDescriptions.speechToText", "Transcribe speech to text"),
            start: this.text("commandDescriptions.start", "Start the bot"),
            systemInfo: this.text("commandDescriptions.systemInfo", "System information"),
            textToSpeech: this.text("commandDescriptions.textToSpeech", "Generate speech from text"),
            title: this.text("commandDescriptions.title", "Change group title"),
            test: this.text("commandDescriptions.test", "System functionality check"),
            transliteration: this.text("commandDescriptions.transliteration", "Transliteration EN <--> RU"),
            unban: this.text("commandDescriptions.unban", "unban user from chat"),
            unignore: this.text("commandDescriptions.unignore", "Bot will start responding to the user"),
            uptime: this.text("commandDescriptions.uptime", "Bot's uptime"),
            whatBetter: this.text("commandDescriptions.whatBetter", "either a or b randomly (50% chance)"),
            when: this.text("commandDescriptions.when", "random date"),
        } as const;
    }

    static getUserSettingsTitle(screen: string): string {
        if (screen === "provider") return this.userSettingsAiProviderSelectionTitle;
        if (screen === "interfaceLanguage") return this.userSettingsInterfaceLanguageSelectionTitle;
        if (screen === "responseLanguage" || screen === "language") return this.userSettingsResponseLanguageSelectionTitle;
        if (screen === "contextSize") return this.userSettingsContextSizeSelectionTitle;
        if (screen === "voiceMode") return this.userSettingsVoiceModeSelectionTitle;
        if (screen === "imageOutput") return this.userSettingsImageOutputSelectionTitle;
        return this.userSettingsTitle;
    }

    static getUserSettingsFieldText(label: string, value: string): string {
        return `${label}: ${value}`;
    }

    static getUserSettingsSelectedText(text: string): string {
        return `${this.userSettingsSelectedPrefix}${text}`;
    }

    static getUserSettingsContextSizeText(size: number): string {
        return this.text("getUserSettingsContextSizeText", "{size} tokens", {size});
    }

    static getCancelledText(provider: string): string {
        return this.text("getCancelledText", "{provider}\n❌ Generation cancelled.", {provider});
    }

    static get startingImageGenText() {
        return this.text("startingImageGenText", "🌈 Starting image generation...");
    }

    static get imageGenText() {
        return this.text("imageGenText", "🌈 Generating image...");
    }

    static get finalizingImageGenText() {
        return this.text("finalizingImageGenText", "🌈 Finalizing image generation...");
    }

    static getPartialImageGenText(iteration: number, total: number): string {
        return this.text("getPartialImageGenText", "🌈 Generating image ({iteration}/{total})...", {iteration, total});
    }

    static getImageGenDoneText(model?: string): string {
        return model
            ? this.text("getImageGenDoneText.withModel", "👨‍🎨 Image generated. Model: `{model}`.", {model})
            : this.text("getImageGenDoneText.default", "👨‍🎨 Image generated.");
    }

    static getErrorText(error?: ErrorLike | BoundaryValue | null | undefined): string {
        if (!error) return this.errorText;

        const reason = error instanceof Error ? error.message : String(error);
        return this.text("getErrorText.withReason", "{errorText} Reason:\n{reason}", {
            errorText: this.errorText,
            reason,
        });
    }

    static getUptimeText(processUptime: string, osUptime: string): string {
        return `${Environment.IS_DOCKER ? this.dockerContainerLabelText : this.processLabelText}:\n${processUptime}\n\n${this.systemLabelText}:\n${osUptime}`;
    }

    static getExpandableBlockquoteText(content: string): string {
        return `<blockquote expandable>${content}</blockquote>`;
    }

    static getSystemSpecsText(params: {
        os: string;
        runtime: string;
        docker: boolean;
        cpu: string;
        ramGb: string;
    }): string {
        return [
            `${this.systemInfoOsLabelText}: ${params.os}`,
            `${this.systemInfoRuntimeLabelText}: ${params.runtime}`,
            `${this.systemInfoDockerLabelText}: ${params.docker}`,
            `${this.systemInfoCpuLabelText}: ${params.cpu}`,
            `${this.systemInfoRamLabelText}: ${params.ramGb} GB`,
        ].join("\n");
    }

    static getIdText(chatId: number | string, fromId: number | string | undefined, replyId?: number | string): string {
        let text = `${this.idChatLabelText}: \n\`\`\`${chatId}\`\`\` \n${this.idFromLabelText}: \n\`\`\`${fromId}\`\`\``;
        if (replyId !== undefined) {
            text += ` \n${this.idReplyLabelText}: \n\`\`\`${replyId}\`\`\``;
        }
        return text;
    }

    static getRandomIntRangeText(min: number, max: number, value: number): string {
        return this.text("getRandomIntRangeText", "[{min}; {max}]: {value}", {min, max, value});
    }

    static getRuntimeCapabilityLineText(params: {
        state: string;
        title: string;
        model?: string;
        endpointBaseUrl?: string;
        external?: boolean;
    }): string {
        const modelPart = params.model ? ` (${params.model})` : "";
        const endpointPart = params.endpointBaseUrl ? ` @ ${params.endpointBaseUrl}` : "";
        const externalPart = params.external ? ` ${this.runtimeExternalLabelText}` : "";
        return this.text("getRuntimeCapabilityLineText", "{state} {title}{modelPart}{endpointPart}{externalPart}", {
            state: params.state,
            title: params.title,
            modelPart,
            endpointPart,
            externalPart,
        });
    }

    static getRuntimeModelInfoText(provider: string, model: string | undefined, capabilities: string[]): string {
        return [
            `${this.runtimeProviderLabelText}: ${provider}`,
            `${this.runtimeModelLabelText}: ${model}`,
            "",
            `${this.runtimeCapabilitiesLabelText}:`,
            ...capabilities,
        ].join("\n");
    }

    static getInfoToolsBlockText(toolNames: string[]): string {
        return [
            `\`\`\`${this.infoToolsBlockLabelText}`,
            toolNames.map(name => `- ${name}`).join("\n"),
            "```",
        ].join("\n");
    }

    static getInfoCommandsBlockText(params: {
        publicCommands: number;
        privateCommands: number;
        chatCommands: number;
        callbackCommands: number;
    }): string {
        return [
            `\`\`\`${this.infoCommandsBlockLabelText}`,
            `${this.infoPublicLabelText}: ${params.publicCommands}`,
            `${this.infoPrivateLabelText}: ${params.privateCommands}`,
            `${this.infoChatLabelText}: ${params.chatCommands}`,
            `${this.infoCallbackLabelText}: ${params.callbackCommands}`,
            "```",
        ].join("\n");
    }

    static getUseToolText(toolCalls: ToolCallData[] | string[]): string {
        const isString = (toolCall: ToolCallData | string) => {
            return typeof toolCall === "string";
        };

        return toolCalls.map(toolCall => {
            const name = isString(toolCall) ? toolCall : toolCall.name;
            return name === PYTHON_INTERPRETER_TOOL_NAME
                ? this.text("getUseToolText.python", "👨‍💻 Running `Python`")
                : name === "code_interpreter"
                    ? this.text("getUseToolText.codeInterpreter", "👨‍💻 Running `Code Interpreter`")
                : this.text("getUseToolText.default", "🔧 Using tool `{name}`", {name});
        }).join("\n");
    }

    static getAnalyzingDocumentText(documentNames?: string[]): string {
        if (!documentNames) return this.text("getAnalyzingDocumentText.default", "🔍 Analyzing the document...");
        if (documentNames.length === 1) {
            return this.text("getAnalyzingDocumentText.single", "🔍 Analyzing document: `{name}`", {name: documentNames[0]});
        }

        return this.text("getAnalyzingDocumentText.many", "🔍 Analyzing documents: {names}", {
            names: documentNames.map(n => `\`${n}\``).join(", "),
        });
    }

    static getPreparingRAGText(documentNames?: string[]): string {
        if (!documentNames) return this.text("getPreparingRAGText.default", "🔍 Preparing RAG for the document...");
        if (documentNames.length === 1) {
            return this.text("getPreparingRAGText.single", "🔍 Preparing RAG for document: `{name}`", {name: documentNames[0]});
        }

        return this.text("getPreparingRAGText.many", "🔍 Preparing RAG for documents: {names}", {
            names: documentNames.map(n => `\`${n}\``).join(", "),
        });
    }

    static getSelectingToolsText(): string {
        return this.text("getSelectingToolsText", "🧩 Выбираю подходящие инструменты...");
    }

    static getBuildingRAGIndexText(modelName?: string): string {
        return modelName
            ? this.text("getBuildingRAGIndexText.withModel", "🧠 Building RAG index: `{modelName}`.", {modelName})
            : this.text("getBuildingRAGIndexText.default", "🧠 Building RAG index...");
    }

    static getAiQueueText(provider: AiProvider, requestsBefore: number): string {
        const count = Math.max(0, requestsBefore);
        const beforeText = count === 0 ? this.text("queueNoneText", "none") : count.toString();
        return [
            this.text("getAiQueueText.queued", "⏳ Request to {provider} is queued.", {provider: provider.toString().toLowerCase()}),
            this.text("getAiQueueText.ahead", "Requests ahead: {count}.", {count: beforeText}),
        ].join("\n");
    }

    static getTelegramFileTooLargeText(fileName: string, maxSizeMb: number): string {
        return this.text("getTelegramFileTooLargeText", "File {fileName} is larger than {maxSizeMb} MB and cannot be sent.", {
            fileName,
            maxSizeMb
        });
    }

    static getUserIsNowAdminText(name: string): string {
        return this.text("getUserIsNowAdminText", "{name} is now an admin!", {name});
    }

    static getUserAlreadyAdminText(name: string): string {
        return this.text("getUserAlreadyAdminText", "{name} is already an admin 🤔", {name});
    }

    static getUserNoLongerAdminText(name: string): string {
        return this.text("getUserNoLongerAdminText", "{name} is no longer an admin!", {name});
    }

    static getUserWasNotAdminText(name: string): string {
        return this.text("getUserWasNotAdminText", "{name} was not an admin 🤔", {name});
    }

    static get botCannotMakeItselfAdminText() {
        return this.text("botCannotMakeItselfAdminText", "The bot cannot make itself an admin");
    }

    static get botCreatorAlreadyAdminText() {
        return this.text("botCreatorAlreadyAdminText", "The bot creator is already an admin");
    }

    static get botCannotRemoveItselfFromAdminsText() {
        return this.text("botCannotRemoveItselfFromAdminsText", "The bot cannot remove itself from admins");
    }

    static get botCreatorCannotStopBeingAdminText() {
        return this.text("botCreatorCannotStopBeingAdminText", "The bot creator cannot stop being an admin");
    }

    static get botWillNotBanCreatorText() {
        return this.text("botWillNotBanCreatorText", "The bot will not ban its creator.");
    }

    static get botWillNotBanAdminsText() {
        return this.text("botWillNotBanAdminsText", "The bot will not ban its administrators.");
    }

    static get botIsNotBannedByItselfText() {
        return this.text("botIsNotBannedByItselfText", "The bot is not banned by itself anyway.");
    }

    static get botCreatorNeverBannedText() {
        return this.text("botCreatorNeverBannedText", "The bot creator is not banned and never will be.");
    }

    static get botAdminsNotBannedText() {
        return this.text("botAdminsNotBannedText", "Bot administrators are not banned anyway.");
    }

    static get botWillNotIgnoreItselfText() {
        return this.text("botWillNotIgnoreItselfText", "The bot will not ignore itself.");
    }

    static get botWillNotIgnoreCreatorText() {
        return this.text("botWillNotIgnoreCreatorText", "The bot will not ignore its creator.");
    }

    static get botWillNotIgnoreAdminsText() {
        return this.text("botWillNotIgnoreAdminsText", "The bot will not ignore its administrators.");
    }

    static get botIsNotIgnoredByItselfText() {
        return this.text("botIsNotIgnoredByItselfText", "The bot is not ignored by itself anyway.");
    }

    static get botCreatorNotIgnoredText() {
        return this.text("botCreatorNotIgnoredText", "The bot creator is not ignored and never will be.");
    }

    static get botAdminsNotIgnoredText() {
        return this.text("botAdminsNotIgnoredText", "Bot administrators are not ignored anyway.");
    }

    static get botAlreadyAlwaysListensToItselfText() {
        return this.text("botAlreadyAlwaysListensToItselfText", "The bot already always listens to itself");
    }

    static get botAlwaysListensToCreatorText() {
        return this.text("botAlwaysListensToCreatorText", "The bot always listens to its creator");
    }

    static getUserBannedText(name: string): string {
        return this.text("getUserBannedText", "{name} banned 🚫", {name});
    }

    static getUserBanFailedText(name: string): string {
        return this.text("getUserBanFailedText", "Could not ban {name} ☹️", {name});
    }

    static getUserUnbannedText(name: string): string {
        return this.text("getUserUnbannedText", "{name} unbanned ⛓️‍💥", {name});
    }

    static getUserUnbanFailedText(name: string): string {
        return this.text("getUserUnbanFailedText", "Could not unban {name} ☹️", {name});
    }

    static getUserIgnoredText(name: string): string {
        return this.text("getUserIgnoredText", "{name} is muted! 🔇", {name});
    }

    static getUserAlreadyIgnoredText(name: string): string {
        return this.text("getUserAlreadyIgnoredText", "{name} is already muted 🤔", {name});
    }

    static getUserIgnoreFailedText(name: string): string {
        return this.text("getUserIgnoreFailedText", "Could not mute {name} ☹️", {name});
    }

    static getUserUnignoredText(name: string): string {
        return this.text("getUserUnignoredText", "{name} is no longer muted! 🔈", {name});
    }

    static getUserWasNotIgnoredText(name: string): string {
        return this.text("getUserWasNotIgnoredText", "{name} was not muted 🤔", {name});
    }

    static getUserUnignoreFailedText(name: string): string {
        return this.text("getUserUnignoreFailedText", "Could not unmute {name} ☹️", {name});
    }

    static getChoiceText(choice: string): string {
        return this.text("getChoiceText", "Chose *{choice}*", {choice});
    }

    static getCoinResultText(result: string): string {
        return this.text("getCoinResultText", "It landed on *{result}*", {result});
    }

    static get coinHeadsText() {
        return this.text("coinHeadsText", "Heads");
    }

    static get coinTailsText() {
        return this.text("coinTailsText", "Tails");
    }

    static get distortReplyInstructionText() {
        return this.text("distortReplyInstructionText", "Reply with /distort to a message containing an image (photo, document, or sticker).\nExample: /distort 16 80");
    }

    static get distortMissingImageText() {
        return this.text("distortMissingImageText", "I do not see an image in the reply. Send a photo or image file.");
    }

    static getDistortionReadyCaption(amp: number, wavelength: number): string {
        return this.text("getDistortionReadyCaption", "Distortion ready ✅ (amp={amp}, wavelength={wavelength})", {
            amp,
            wavelength
        });
    }

    static getDistortFailedText(error: ErrorLike | BoundaryValue | null | undefined): string {
        return this.text("getDistortFailedText", "Could not distort image: {reason}", {
            reason: error instanceof Error ? error.message : String(error),
        });
    }

    static getLoadedModelsText(modelNames: string[]): string {
        return this.text("getLoadedModelsText", "Loaded models: {models}", {models: modelNames.join(", ")});
    }

    static getSelectedModelText(model: string): string {
        return this.text("getSelectedModelText", "Selected model: `{model}`", {model});
    }

    static getSelectedModelWithInfoText(model: string, info: string): string {
        return this.text("getSelectedModelWithInfoText", "Selected model \"{model}\"\n\n{info}", {model, info});
    }

    static getModelIsNotSetCurrentText(model: string): string {
        return this.text("getModelIsNotSetCurrentText", "Model is not set. Current model: \"{model}\"", {model});
    }

    static getCurrentModelText(model: string): string {
        return this.text("getCurrentModelText", "Current model: `{model}`", {model});
    }

    static getLoadingModelText(model: string): string {
        return this.text("getLoadingModelText", "Loading model `{model}`...", {model});
    }

    static getCurrentModelUnsupportedInputText(model: string, providerName: string, inputKind: string): string {
        return this.text("getCurrentModelUnsupportedInputText", "⚠️ Current model `{model}` ({providerName}) does not support {inputKind}.", {
            model,
            providerName,
            inputKind,
        });
    }

    static getDocumentIsEmptyText(fileName: string): string {
        return this.text("getDocumentIsEmptyText", "Document {fileName} is empty or contains no readable text.", {fileName});
    }

    static getDocumentContentText(fileName: string, content: string): string {
        return this.text("getDocumentContentText", "{label} for \"{fileName}\":\n\n{content}", {
            label: this.documentContentLabelText,
            fileName,
            content,
        });
    }

    static getMistralUploadedDocumentIdMissingText(fileName: string): string {
        return this.text("getMistralUploadedDocumentIdMissingText", "Mistral did not return an uploaded document id for {fileName}.", {fileName});
    }

    static getMistralDocumentProcessingFailedText(fileName: string, status: string): string {
        return this.text("getMistralDocumentProcessingFailedText", "Mistral could not process document {fileName}: {status}", {
            fileName,
            status
        });
    }

    static getMistralDocumentProcessingTimedOutText(fileName: string): string {
        return this.text("getMistralDocumentProcessingTimedOutText", "Mistral did not process document {fileName} within the allotted time.", {fileName});
    }

    static getAttachmentMissingFromCacheText(fileName: string): string {
        return this.text("getAttachmentMissingFromCacheText", "⚠️ Attachment file is missing from the cache: {fileName}", {fileName});
    }

    static getZipInvalidLocalHeaderText(entryName: string): string {
        return this.text("getZipInvalidLocalHeaderText", "ZIP archive is corrupted: invalid local header for {entryName}.", {entryName});
    }

    static getZipUnsupportedCompressionMethodText(method: number, entryName: string): string {
        return this.text("getZipUnsupportedCompressionMethodText", "ZIP archive uses unsupported compression method {method} for {entryName}.", {
            method,
            entryName
        });
    }

    static getGzipUncompressedLimitText(maxBytes: number): string {
        return this.text("getGzipUncompressedLimitText", "GZIP archive exceeds the uncompressed data limit ({maxBytes} bytes).", {maxBytes});
    }

    static getNestedArchiveDepthLimitText(maxDepth: number): string {
        return this.text("getNestedArchiveDepthLimitText", "nested archive depth limit reached ({maxDepth})", {maxDepth});
    }

    static getUnsupportedArchiveFormatText(fileName: string): string {
        return this.text("getUnsupportedArchiveFormatText", "Archive format \"{fileName}\" is not supported by local RAG.", {fileName});
    }

    static getDocumentEmptyOrNoExtractableText(fileName: string): string {
        return this.text("getDocumentEmptyOrNoExtractableText", "Document \"{fileName}\" is empty or contains no extractable text.", {fileName});
    }

    static getUnsupportedLocalRagDocumentFormatText(fileName: string): string {
        return this.text("getUnsupportedLocalRagDocumentFormatText", "Document format \"{fileName}\" is not supported by local RAG. Supported formats: text files, code, CSV, JSON, Markdown, YAML, XML, DOCX, text PDFs, and ZIP/TAR/GZIP archives containing those files.", {fileName});
    }

    static getOllamaEmbeddingInvalidResponseText(model: string): string {
        return this.text("getOllamaEmbeddingInvalidResponseText", "Ollama embedding model \"{model}\" returned an invalid response.", {model});
    }

    static getProviderNotAvailableForAccessText(providerName: string): string {
        return this.text("getProviderNotAvailableForAccessText", "Provider {providerName} is not available for your access level.", {providerName});
    }

    static getProviderSpeechToTextUnsupportedText(providerName: string): string {
        return this.text("getProviderSpeechToTextUnsupportedText", "Provider {providerName} does not support speech-to-text or is not configured for it.", {providerName});
    }

    static getProviderTextToSpeechUnsupportedText(providerName: string): string {
        return this.text("getProviderTextToSpeechUnsupportedText", "Provider {providerName} does not support text-to-speech or is not configured for it.", {providerName});
    }

    static getTextToSpeechTooLongText(actualLength: number, maxLength: number): string {
        return this.text("getTextToSpeechTooLongText", "Text for speech synthesis is too long: {actualLength} characters, maximum {maxLength}.", {
            actualLength,
            maxLength,
        });
    }

    static getTextToSpeechCaption(providerName: string, model: string, voice?: string): string {
        return [
            `TTS: ${providerName}`,
            `model: ${model}`,
            voice ? `voice: ${voice}` : null,
        ].filter(Boolean).join("\n");
    }

    static getQrCodeTextTooLongText(actualLength: number, maxLength: number): string {
        return this.text("getQrCodeTextTooLongText", "Text is too long for QR ({actualLength} characters). It will be trimmed to {maxLength} characters.", {
            actualLength,
            maxLength,
        });
    }

    static getQrCodeReadyText(content: string): string {
        return this.text("getQrCodeReadyText", "QR code ready ✅\nContent:\n<blockquote expandable>{content}</blockquote>", {content});
    }

    static getQrCodeFailedText(error: ErrorLike | BoundaryValue | null | undefined): string {
        return this.text("getQrCodeFailedText", "Could not generate QR: {reason}", {
            reason: error instanceof Error ? error.message : String(error),
        });
    }

    static get shutdownFallbackText() {
        return this.text("shutdownFallbackText", "...");
    }

    static get shutdownSequenceTexts() {
        return this.textArray("shutdownSequenceTexts", [
            "well then, everyone",
            "it was nice talking to you",
            "but it is time for me to rest",
            "all the best",
        ]);
    }

    static get shutdownDoneText() {
        return this.text("shutdownDoneText", "*R.I.P*");
    }

    static getWhenPrefixText(): string {
        return this.text("getWhenPrefixText", "in ");
    }

    static get whenNowText() {
        return this.text("whenNowText", "right now");
    }

    static get whenNeverText() {
        return this.text("whenNeverText", "never");
    }

    static get whenYearUnitText() {
        return this.text("whenYearUnitText", "year");
    }

    static get whenDayUnitText() {
        return this.text("whenDayUnitText", "day");
    }

    static get whenWeekUnitText() {
        return this.text("whenWeekUnitText", "week");
    }

    static get whenMonthUnitText() {
        return this.text("whenMonthUnitText", "month");
    }

    static get whenHourUnitText() {
        return this.text("whenHourUnitText", "hour");
    }

    static get whenMinuteUnitText() {
        return this.text("whenMinuteUnitText", "minute");
    }

    static get whenSecondUnitText() {
        return this.text("whenSecondUnitText", "second");
    }

    static getWhenDurationText(value: number, unit: string): string {
        const pluralUnit = value === 1 ? unit : this.text("getWhenPluralUnitText", "{unit}s", {unit});
        return this.text("getWhenDurationText", "{prefix}{value} {unit}", {
            prefix: this.getWhenPrefixText(),
            value,
            unit: pluralUnit,
        });
    }

    static getPingReportText(
        telegramPingMs: string,
        apiPingMs: string,
        messageDate: string,
        messageTime: string,
        localDate: string,
        localTime: string,
    ): string {
        return this.text("getPingReportText", "```ping\nTG: {telegramPingMs}ms\nAPI  {apiPingMs}ms\n\n🗓️ Message date: {messageDate}\n🕒 Message time: {messageTime}\n\n🗓️ Local date : {localDate}\n🕒 Local time: {localTime}```", {
            telegramPingMs,
            apiPingMs,
            messageDate,
            messageTime,
            localDate,
            localTime,
        });
    }

    static getAiProviderMaxConcurrentRequests(provider: AiProvider): number {
        switch (provider) {
            case AiProvider.OLLAMA:
                return Environment.OLLAMA_MAX_CONCURRENT_REQUESTS;
            case AiProvider.MISTRAL:
                return Environment.MISTRAL_MAX_CONCURRENT_REQUESTS;
            case AiProvider.OPENAI:
                return Environment.OPENAI_MAX_CONCURRENT_REQUESTS;
        }
    }

    private static processEnvAsRecord(): EnvRecord {
        return Object.fromEntries(
            Object.entries(process.env)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
    }

    private static parseNumberSet(value: string | undefined): Set<number> {
        if (!value) {
            return new Set<number>();
        }

        const numbers = value
            .split(",")
            .map(e => Number.parseInt(e.trim(), 10))
            .filter(Number.isSafeInteger);

        return new Set<number>(numbers);
    }

    private static getFileMtimeMs(filePath: string): number | undefined {
        try {
            return fs.statSync(filePath).mtimeMs;
        } catch (e) {
            if (e instanceof Error && "code" in e && (e as {code?: string}).code === "ENOENT") {
                return undefined;
            }

            throw e;
        }
    }

    private static readEnvFile(): EnvRecord {
        if (!fs.existsSync(Environment.ENV_FILE_PATH)) {
            return {};
        }

        const envFile = fs.readFileSync(Environment.ENV_FILE_PATH, "utf8");
        return parseDotEnv(envFile);
    }

    private static readConfigSource(): EnvRecord {
        return {
            ...Environment.readEnvFile(),
            ...Environment.processEnvAsRecord(),
        };
    }

    static getOptionalConfigValue(name: string): string | undefined {
        return normalizeString(Environment.readConfigSource()[name]);
    }

    private static getSystemPromptPath(): string {
        return path.join(Environment.DATA_PATH, "SYSTEM_PROMPT.md");
    }

    private static getRankerToolPromptPath(): string {
        return path.join(Environment.DATA_PATH, "TOOL_RANKER_PROMPT.md");
    }

    private static readSystemPrompt(): string | undefined {
        const promptPath = Environment.getSystemPromptPath();

        if (!fs.existsSync(promptPath)) {
            return undefined;
        }

        const prompt = fs.readFileSync(promptPath, "utf8").trim();
        return prompt.length > 0 ? prompt : undefined;
    }

    private static readRankerToolPromptPath(): string | undefined {
        const promptPath = Environment.getRankerToolPromptPath();

        if (!fs.existsSync(promptPath)) {
            return undefined;
        }

        const prompt = fs.readFileSync(promptPath, "utf8").trim();
        return prompt.length > 0 ? prompt : undefined;
    }

    private static refreshSystemPrompt(): void {
        Environment.SYSTEM_PROMPT = Environment.readSystemPrompt() ?? Environment.envSystemPrompt;
    }

    private static refreshRankerToolPrompt(): void {
        Environment.RANKER_TOOL_PROMPT = Environment.readRankerToolPromptPath() ?? Environment.envRankerToolPrompt;
    }

    private static applyStartupEnv(env: StartupEnv): void {
        Environment.BOT_TOKEN = env.BOT_TOKEN;
        Environment.TEST_ENVIRONMENT = env.TEST_ENVIRONMENT;
        Environment.IS_DOCKER = env.IS_DOCKER ?? false;

        const defaultDataPath = env.DATA_PATH
            ?? (Environment.IS_DOCKER
                ? "/" + path.join("config", "data")
                : path.join(os.homedir(), ".local", "share", "tg-chat-bot"));
        const defaultDatabaseUrl = "file:" + path.join(defaultDataPath, Environment.DB_FILE_NAME);
        const databaseUrl = env.DATABASE_URL ?? env.DB_PATH ?? defaultDatabaseUrl;

        Environment.DATA_PATH = defaultDataPath;
        Environment.DB_PATH = databaseUrl;
        Environment.DB_KIND = /^postgres(?:ql)?:\/\//i.test(databaseUrl) ? "postgres" : "sqlite";
        Environment.DB_FILE_PATH = databaseUrl.startsWith("file:")
            ? databaseUrl.slice("file:".length)
            : undefined;
    }

    private static applyRuntimeEnv(env: RuntimeEnv): void {
        Environment.CHAT_IDS_WHITELIST = Environment.parseNumberSet(env.CHAT_IDS_WHITELIST);
        Environment.BOT_PREFIX = env.BOT_PREFIX;
        Environment.CREATOR_ID = env.CREATOR_ID;
        Environment.ONLY_FOR_CREATOR_MODE = env.ONLY_FOR_CREATOR_MODE;
        Environment.ENABLE_UNSAFE_EVAL = env.ENABLE_UNSAFE_EVAL;
        Environment.MAX_PHOTO_SIZE = env.MAX_PHOTO_SIZE;
        Environment.PROCESS_LINKS = env.PROCESS_LINKS;
        Environment.LOCALES_DIR = env.LOCALES_DIR;
        Localization.configure(env.LOCALES_DIR);

        Environment.RATE_LIMIT_FALLBACK_POLICY = env.RATE_LIMIT_FALLBACK_POLICY;
        Environment.IMAGE_HANDLE_POLICY = env.IMAGE_HANDLE_POLICY;
        Environment.IMAGE_HANDLE_FALLBACK_POLICY = env.IMAGE_HANDLE_FALLBACK_POLICY;

        Environment.BRAVE_SEARCH_API_KEY = env.BRAVE_SEARCH_API_KEY;
        Environment.OPEN_WEATHER_MAP_API_KEY = env.OPEN_WEATHER_MAP_API_KEY;

        Environment.FILE_TOOLS_ROOT_DIR = env.FILE_TOOLS_ROOT_DIR
            ? path.resolve(env.FILE_TOOLS_ROOT_DIR)
            : undefined;

        Environment.ENABLE_FS_TOOLS = env.ENABLE_FS_TOOLS ?? false;

        Environment.DEFAULT_AI_PROVIDER = env.DEFAULT_AI_PROVIDER;

        Environment.envSystemPrompt = env.SYSTEM_PROMPT;
        Environment.envRankerToolPrompt = env.RANKER_TOOL_PROMPT;
        Environment.SYSTEM_PROMPT = env.SYSTEM_PROMPT;
        Environment.RANKER_TOOL_PROMPT = env.RANKER_TOOL_PROMPT;
        Environment.USE_NAMES_IN_PROMPT = env.USE_NAMES_IN_PROMPT;
        Environment.USE_SYSTEM_PROMPT = env.USE_SYSTEM_PROMPT;
        Environment.SEND_TIME_TOOK = env.SEND_TIME_TOOK ?? false;

        Environment.ENABLE_PYTHON_INTERPRETER = env.ENABLE_PYTHON_INTERPRETER ?? false;
        Environment.DISABLE_LOCAL_TOOLS = env.DISABLE_LOCAL_TOOLS ?? false;
        Environment.LOCAL_TOOL_ALLOWLIST = env.LOCAL_TOOL_ALLOWLIST;
        Environment.LOCAL_TOOL_DENYLIST = env.LOCAL_TOOL_DENYLIST;
        Environment.MCP_SERVERS = env.MCP_SERVERS;

        Environment.OLLAMA_API_KEY = env.OLLAMA_API_KEY;
        Environment.OLLAMA_ADDRESS = env.OLLAMA_ADDRESS;
        Environment.OLLAMA_CHAT_MODEL = env.OLLAMA_CHAT_MODEL;
        Environment.OLLAMA_IMAGE_MODEL = env.OLLAMA_IMAGE_MODEL ?? env.OLLAMA_CHAT_MODEL;
        Environment.OLLAMA_THINK_MODEL = env.OLLAMA_THINK_MODEL ?? env.OLLAMA_CHAT_MODEL;
        Environment.OLLAMA_AUDIO_MODEL = env.OLLAMA_AUDIO_MODEL ?? env.OLLAMA_CHAT_MODEL;
        Environment.OLLAMA_EMBEDDING_MODEL = env.OLLAMA_EMBEDDING_MODEL;
        Environment.OLLAMA_RAG_CHUNK_SIZE = env.OLLAMA_RAG_CHUNK_SIZE;
        Environment.OLLAMA_RAG_CHUNK_OVERLAP = Math.min(env.OLLAMA_RAG_CHUNK_OVERLAP, Math.max(1, env.OLLAMA_RAG_CHUNK_SIZE - 1));
        Environment.OLLAMA_RAG_TOP_K = env.OLLAMA_RAG_TOP_K;
        Environment.OLLAMA_RAG_MAX_CONTEXT_CHARS = env.OLLAMA_RAG_MAX_CONTEXT_CHARS;
        Environment.OLLAMA_RAG_MIN_SCORE = env.OLLAMA_RAG_MIN_SCORE;
        Environment.OLLAMA_RAG_MAX_ARCHIVE_FILES = env.OLLAMA_RAG_MAX_ARCHIVE_FILES;
        Environment.OLLAMA_RAG_MAX_ARCHIVE_BYTES = env.OLLAMA_RAG_MAX_ARCHIVE_BYTES;
        Environment.OLLAMA_RAG_MAX_ARCHIVE_DEPTH = env.OLLAMA_RAG_MAX_ARCHIVE_DEPTH;
        Environment.OLLAMA_MAX_CONCURRENT_REQUESTS = env.OLLAMA_MAX_CONCURRENT_REQUESTS;

        Environment.MISTRAL_API_KEY = env.MISTRAL_API_KEY;
        Environment.MISTRAL_MODEL = env.MISTRAL_MODEL;
        Environment.MISTRAL_TRANSCRIPTION_MODEL = env.MISTRAL_TRANSCRIPTION_MODEL;
        Environment.MISTRAL_TTS_MODEL = env.MISTRAL_TTS_MODEL;
        Environment.MISTRAL_TTS_VOICE_ID = env.MISTRAL_TTS_VOICE_ID;
        Environment.MISTRAL_MAX_CONCURRENT_REQUESTS = env.MISTRAL_MAX_CONCURRENT_REQUESTS;

        Environment.OPENAI_BASE_URL = env.OPENAI_BASE_URL;
        Environment.OPENAI_API_KEY = env.OPENAI_API_KEY;
        Environment.OPENAI_MODEL = env.OPENAI_MODEL;
        Environment.OPENAI_IMAGE_MODEL = env.OPENAI_IMAGE_MODEL;
        Environment.OPENAI_TRANSCRIPTION_MODEL = env.OPENAI_TRANSCRIPTION_MODEL;
        Environment.OPENAI_TTS_MODEL = env.OPENAI_TTS_MODEL;
        Environment.OPENAI_TTS_VOICE = env.OPENAI_TTS_VOICE;
        Environment.OPENAI_TTS_INSTRUCTIONS = env.OPENAI_TTS_INSTRUCTIONS;
        Environment.OPENAI_MAX_CONCURRENT_REQUESTS = env.OPENAI_MAX_CONCURRENT_REQUESTS;
    }

    static load(): void {
        const rawEnv = Environment.readConfigSource();

        const startupEnv = StartupEnvSchema.parse(rawEnv);
        const runtimeEnv = RuntimeEnvSchema.parse(rawEnv);

        Environment.applyStartupEnv(startupEnv);
        Environment.applyRuntimeEnv(runtimeEnv);

        Environment.refreshSystemPrompt();
        Environment.refreshRankerToolPrompt();

        Environment.lastEnvMtimeMs = Environment.getFileMtimeMs(Environment.ENV_FILE_PATH);
        Environment.lastSystemPromptMtimeMs = Environment.getFileMtimeMs(Environment.getSystemPromptPath());
        Environment.lastRankerToolPromptMtimeMs = Environment.getFileMtimeMs(Environment.getRankerToolPromptPath());
    }

    static reloadRuntimeConfigIfChanged(): void {
        try {
            const envMtimeMs = Environment.getFileMtimeMs(Environment.ENV_FILE_PATH);
            const systemPromptMtimeMs = Environment.getFileMtimeMs(Environment.getSystemPromptPath());
            const rankerToolPromptMtimeMs = Environment.getFileMtimeMs(Environment.getRankerToolPromptPath());

            const envChanged = envMtimeMs !== Environment.lastEnvMtimeMs;
            const systemPromptChanged = systemPromptMtimeMs !== Environment.lastSystemPromptMtimeMs;
            const rankerToolPromptChanged = rankerToolPromptMtimeMs !== Environment.lastRankerToolPromptMtimeMs;

            Localization.reloadIfChanged();

            if (!envChanged && !systemPromptChanged) {
                return;
            }

            if (envChanged) {
                const rawEnv = Environment.readConfigSource();
                const runtimeEnv = RuntimeEnvSchema.parse(rawEnv);

                Environment.applyRuntimeEnv(runtimeEnv);
                Environment.refreshSystemPrompt();
                Environment.refreshRankerToolPrompt();
                Environment.lastEnvMtimeMs = envMtimeMs;
            }

            if (systemPromptChanged) {
                Environment.refreshSystemPrompt();
                Environment.lastSystemPromptMtimeMs = systemPromptMtimeMs;
            }

            if (rankerToolPromptChanged) {
                Environment.refreshRankerToolPrompt();
                Environment.lastRankerToolPromptMtimeMs = rankerToolPromptMtimeMs;
            }
        } catch (e) {
            appLogger.child("environment").error("runtime_reload.failed", {error: e instanceof Error ? e : String(e)});
        }
    }

    static setOnlyForCreatorMode(enable: boolean): void {
        this.ONLY_FOR_CREATOR_MODE = enable;
    }

    static setBraveSearchApiKey(apiKey: string | undefined): void {
        this.BRAVE_SEARCH_API_KEY = apiKey;
    }

    static setOpenWeatherMapApiKey(openWeatherMapApiKey: string | undefined): void {
        this.OPEN_WEATHER_MAP_API_KEY = openWeatherMapApiKey;
    }

    static setFileToolsRootDir(rootDir: string | undefined): void {
        this.FILE_TOOLS_ROOT_DIR = rootDir ? path.resolve(rootDir) : undefined;
    }

    static setSystemPrompt(prompt: string | undefined): void {
        this.SYSTEM_PROMPT = prompt;
    }

    static setUseNamesInPrompt(use: boolean): void {
        this.USE_NAMES_IN_PROMPT = use;
    }

    static setUseSystemPrompt(use: boolean): void {
        this.USE_SYSTEM_PROMPT = use;
    }

    static setSendTimeTook(send: boolean): void {
        this.SEND_TIME_TOOK = send;
    }

    static setAdmins(admins: Set<number>): void {
        this.ADMIN_IDS = admins;
    }

    static async addAdmin(id: number): Promise<boolean> {
        const has = this.ADMIN_IDS.has(id);

        if (!has) {
            this.ADMIN_IDS.add(id);
            const {saveData} = await import("../db/database.js");
            await saveData();
        }

        return !has;
    }

    static async removeAdmin(id: number): Promise<boolean> {
        const has = this.ADMIN_IDS.has(id);

        if (has) {
            this.ADMIN_IDS.delete(id);
            const {saveData} = await import("../db/database.js");
            await saveData();
        }

        return has;
    }

    static setMuted(muted: Set<number>): void {
        this.MUTED_IDS = muted;
    }

    static async addMute(id: number): Promise<boolean> {
        if (this.MUTED_IDS.has(id)) {
            return false;
        }

        this.MUTED_IDS.add(id);
        const {saveData} = await import("../db/database.js");
        await saveData();
        return true;
    }

    static async removeMute(id: number): Promise<boolean> {
        if (!this.MUTED_IDS.has(id)) {
            return false;
        }

        this.MUTED_IDS.delete(id);
        const {saveData} = await import("../db/database.js");
        await saveData();
        return true;
    }

    static setAnswers(answers: Answers): void {
        this.ANSWERS = answers;
    }

    static setOllamaApiKey(key: string | undefined): void {
        this.OLLAMA_API_KEY = key;
    }

    static setOllamaAddress(address: string | undefined): void {
        this.OLLAMA_ADDRESS = address;
    }

    static setOllamaModel(ollamaModel: string): void {
        this.OLLAMA_CHAT_MODEL = ollamaModel;
    }

    static setOllamaThinkModel(ollamaThinkModel: string): void {
        this.OLLAMA_THINK_MODEL = ollamaThinkModel;
    }

    static setOllamaImageModel(ollamaImageModel: string): void {
        this.OLLAMA_IMAGE_MODEL = ollamaImageModel;
    }

    static setMistralApiKey(newMistralApiKey: string | undefined): void {
        this.MISTRAL_API_KEY = newMistralApiKey;
    }

    static setMistralModel(newModel: string): void {
        this.MISTRAL_MODEL = newModel;
    }

    static setMistralTranscriptionModel(newModel: string): void {
        this.MISTRAL_TRANSCRIPTION_MODEL = newModel;
    }

    static setMistralTtsModel(newModel: string): void {
        this.MISTRAL_TTS_MODEL = newModel;
    }

    static setOpenAIBaseUrl(newAIBaseUrl: string | undefined): void {
        this.OPENAI_BASE_URL = newAIBaseUrl;
    }

    static setOpenAIApiKey(newAIApiKey: string | undefined): void {
        this.OPENAI_API_KEY = newAIApiKey;
    }

    static setOpenAIModel(newModel: string): void {
        this.OPENAI_MODEL = newModel;
    }

    static setOpenAIImageModel(newImageModel: string): void {
        this.OPENAI_IMAGE_MODEL = newImageModel;
    }

    static setOpenAITranscriptionModel(newModel: string): void {
        this.OPENAI_TRANSCRIPTION_MODEL = newModel;
    }

    static setOpenAITtsModel(newModel: string): void {
        this.OPENAI_TTS_MODEL = newModel;
    }
}
