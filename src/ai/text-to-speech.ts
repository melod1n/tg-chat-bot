import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {FileOptions, Message} from "typescript-telegram-bot-api";
import {AiProvider} from "../model/ai-provider";
import {Environment} from "../common/environment";
import {bot} from "../index";
import {
    getAvailableAiProviderChoices,
    normalizeAiProviderChoice,
    resolveEffectiveAiProviderForUser,
} from "../common/user-ai-settings";
import {providerDisplayName} from "./provider-aliases";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import {MessageStore} from "../common/message-store";
import {StoredAttachment} from "../model/stored-attachment";
import {StoredMessage} from "../model/stored-message";
import {logError} from "../util/utils";
import {SpeechRequest} from "@mistralai/mistralai/models/components";
import {createMistralClient, createOpenAiClient, resolveAiRuntimeTarget} from "./ai-runtime-target";
import {PIPELINE_ATTACHMENT_LIMIT_BYTES} from "./user-request-pipeline";

const MAX_TTS_TEXT_CHARS = 4096;

export type TextToSpeechFormat = "mp3" | "wav" | "flac" | "opus" | "aac" | "pcm";

export type SynthesizedSpeech = {
    provider: AiProvider;
    model: string;
    voice?: string;
    format: TextToSpeechFormat;
    mimeType: string;
    fileName: string;
    path: string;
    sizeBytes: number;
};

export type TextToSpeechRequest = {
    provider: AiProvider;
    text: string;
    voice?: string;
};

export type TextToSpeechProviderResolution = {
    provider: AiProvider;
    fallback: boolean;
};

type SpeechFileParams = Omit<SynthesizedSpeech, "fileName" | "path" | "sizeBytes"> & {
    buffer: Buffer;
};

function ttsCacheDir(): string {
    return path.join(Environment.DATA_PATH, "cache", "audio");
}

function assertText(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
        throw new Error(Environment.noTextToSynthesizeText);
    }

    if (normalized.length > MAX_TTS_TEXT_CHARS) {
        throw new Error(Environment.getTextToSpeechTooLongText(normalized.length, MAX_TTS_TEXT_CHARS));
    }

    return normalized;
}

export function isTextToSpeechConfigured(provider: AiProvider): boolean {
    switch (provider) {
        case AiProvider.OPENAI:
            const openAiTarget = resolveAiRuntimeTarget(provider, "textToSpeech");
            return !!openAiTarget.apiKey && !!openAiTarget.model;
        case AiProvider.MISTRAL:
            const mistralTarget = resolveAiRuntimeTarget(provider, "textToSpeech");
            return !!mistralTarget.apiKey && !!mistralTarget.model;
        case AiProvider.OLLAMA:
            return false;
    }
}

export async function resolveTextToSpeechProviderForUser(
    userId: number,
    explicitProvider?: AiProvider,
): Promise<TextToSpeechProviderResolution> {
    const availableChoices = getAvailableAiProviderChoices(userId);
    const allowedProviders = availableChoices
        .map(choice => normalizeAiProviderChoice(choice))
        .filter((choice): choice is AiProvider => !!choice && choice !== "DEFAULT");

    if (explicitProvider) {
        if (!allowedProviders.includes(explicitProvider)) {
            throw new Error(Environment.getProviderNotAvailableForAccessText(providerDisplayName(explicitProvider)));
        }

        if (!isTextToSpeechConfigured(explicitProvider)) {
            throw new Error(Environment.getProviderTextToSpeechUnsupportedText(providerDisplayName(explicitProvider)));
        }

        return {provider: explicitProvider, fallback: false};
    }

    const effectiveProvider = await resolveEffectiveAiProviderForUser(userId);
    if (isTextToSpeechConfigured(effectiveProvider)) {
        return {provider: effectiveProvider, fallback: false};
    }

    const fallbackProvider = allowedProviders.find(isTextToSpeechConfigured);
    if (!fallbackProvider) {
        throw new Error(Environment.noTextToSpeechProviderForAccessText);
    }

    return {provider: fallbackProvider, fallback: true};
}

export async function synthesizeSpeech(request: TextToSpeechRequest): Promise<SynthesizedSpeech> {
    const text = assertText(request.text);

    switch (request.provider) {
        case AiProvider.OPENAI:
            return synthesizeOpenAiSpeech(text, request.voice);
        case AiProvider.MISTRAL:
            return synthesizeMistralSpeech(text, request.voice);
        case AiProvider.OLLAMA:
            throw new Error(Environment.ollamaTextToSpeechUnsupportedText);
    }
}

async function synthesizeOpenAiSpeech(text: string, voice?: string): Promise<SynthesizedSpeech> {
    const target = resolveAiRuntimeTarget(AiProvider.OPENAI, "textToSpeech");
    const openAi = createOpenAiClient(target);
    const response = await openAi.audio.speech.create({
        model: target.model,
        voice: voice || Environment.OPENAI_TTS_VOICE,
        input: text,
        response_format: "mp3",
        instructions: Environment.OPENAI_TTS_INSTRUCTIONS,
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    return writeSpeechFile({
        provider: AiProvider.OPENAI,
        model: target.model,
        voice: voice || Environment.OPENAI_TTS_VOICE,
        buffer,
        format: "mp3",
        mimeType: "audio/mpeg",
    });
}

async function synthesizeMistralSpeech(text: string, voice?: string): Promise<SynthesizedSpeech> {
    const target = resolveAiRuntimeTarget(AiProvider.MISTRAL, "textToSpeech");
    const mistralAi = createMistralClient(target);
    const request: SpeechRequest = {
        input: text,
        responseFormat: "mp3"
        // stream: false,
    };

    if (target.model) request.model = target.model;
    if (voice || Environment.MISTRAL_TTS_VOICE_ID) request.voiceId = voice || Environment.MISTRAL_TTS_VOICE_ID;

    const response = await mistralAi.audio.speech.complete(request) as {audioData?: string; audio_data?: string};
    const audioData = response?.audioData ?? response?.audio_data;
    if (typeof audioData !== "string" || !audioData.trim()) {
        throw new Error(Environment.mistralTtsNoAudioDataText);
    }

    const buffer = Buffer.from(audioData, "base64");

    return writeSpeechFile({
        provider: AiProvider.MISTRAL,
        model: target.model || "mistral speech",
        voice: voice || Environment.MISTRAL_TTS_VOICE_ID,
        buffer,
        format: "mp3",
        mimeType: "audio/mpeg",
    });
}

function writeSpeechFile(params: SpeechFileParams): SynthesizedSpeech {
    fs.mkdirSync(ttsCacheDir(), {recursive: true});

    const fileName = `${params.provider.toLowerCase()}-tts-${Date.now()}-${randomUUID()}.${params.format}`;
    const filePath = path.join(ttsCacheDir(), fileName);
    fs.writeFileSync(filePath, params.buffer);

    return {
        provider: params.provider,
        model: params.model,
        voice: params.voice,
        format: params.format,
        mimeType: params.mimeType,
        fileName,
        path: filePath,
        sizeBytes: params.buffer.length,
    };
}

function createSpeechUpload(speech: SynthesizedSpeech): FileOptions {
    return new FileOptions(fs.createReadStream(speech.path), {
        filename: speech.fileName,
        contentType: speech.mimeType,
    });
}

function destroyUpload(upload: FileOptions): void {
    if ("destroy" in upload.file && typeof upload.file.destroy === "function") {
        upload.file.destroy();
    }
}

export async function sendSynthesizedSpeech(sourceMessage: Message, speech: SynthesizedSpeech): Promise<Message> {
    if (speech.sizeBytes > PIPELINE_ATTACHMENT_LIMIT_BYTES) {
        throw new Error(Environment.speechFileTooLargeText);
    }

    const caption = Environment.getTextToSpeechCaption(providerDisplayName(speech.provider), speech.model, speech.voice);

    await enqueueTelegramApiCall(
        () => bot.sendChatAction({
            chat_id: sourceMessage.chat.id,
            action: speech.format === "mp3" || speech.format === "opus" ? "upload_voice" : "upload_document",
        }),
        {method: "sendChatAction", chatId: sourceMessage.chat.id, chatType: sourceMessage.chat.type}
    ).catch(logError);

    let sent: Message;
    if (speech.format === "mp3" || speech.format === "opus") {
        try {
            sent = await enqueueTelegramApiCall(
                async () => {
                    const upload = createSpeechUpload(speech);
                    try {
                        return await bot.sendVoice({
                            chat_id: sourceMessage.chat.id,
                            voice: upload,
                            caption,
                            reply_parameters: {message_id: sourceMessage.message_id},
                        });
                    } finally {
                        // destroyUpload(upload);
                    }
                },
                {method: "sendVoice", chatId: sourceMessage.chat.id, chatType: sourceMessage.chat.type}
            );
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        sent = await sendSpeechDocument(sourceMessage, speech, caption);
    }
    } else {
        sent = await sendSpeechDocument(sourceMessage, speech, caption);
    }

    await storeSpeechMessage(sent, sourceMessage, speech);
    return sent;
}

export function speechToOutputAttachmentRecord(speech: SynthesizedSpeech, messageId?: number) {
    return {
        artifactKind: "tts_audio" as const,
        fileName: speech.fileName,
        mimeType: speech.mimeType,
        sizeBytes: speech.sizeBytes,
        messageId,
    };
}

async function sendSpeechDocument(sourceMessage: Message, speech: SynthesizedSpeech, caption: string): Promise<Message> {
    return enqueueTelegramApiCall(
        async () => {
            const upload = createSpeechUpload(speech);
            try {
                return await bot.sendDocument({
                    chat_id: sourceMessage.chat.id,
                    document: upload,
                    caption,
                    reply_parameters: {message_id: sourceMessage.message_id},
                });
            } finally {
                destroyUpload(upload);
            }
        },
        {method: "sendDocument", chatId: sourceMessage.chat.id, chatType: sourceMessage.chat.type}
    );
}

async function storeSpeechMessage(sent: Message, sourceMessage: Message, speech: SynthesizedSpeech): Promise<void> {
    const file = sent.voice ?? sent.audio ?? sent.document;
    const attachment: StoredAttachment = {
        kind: "audio",
        fileId: file?.file_id ?? speech.path,
        fileUniqueId: file?.file_unique_id,
        fileName: speech.fileName,
        mimeType: speech.mimeType,
        cachePath: speech.path,
        sizeBytes: speech.sizeBytes,
        scope: "bot_output",
        artifactKind: "tts_audio",
        metadata: {
            provider: speech.provider,
            model: speech.model,
            voice: speech.voice,
            format: speech.format,
        },
    };

    const stored: StoredMessage = {
        chatId: sent.chat.id,
        id: sent.message_id,
        replyToMessageId: sent.reply_to_message?.message_id ?? sourceMessage.message_id,
        fromId: sent.from?.id ?? 0,
        text: sent.caption ?? speech.fileName,
        date: sent.date ?? Math.floor(Date.now() / 1000),
        attachments: [attachment],
    };

    await MessageStore.put(stored);
}
