import fs, {openAsBlob} from "node:fs";
import {AiProvider} from "../model/ai-provider";
import {
    getAvailableAiProviderChoices,
    normalizeAiProviderChoice,
    resolveEffectiveAiProviderForUser,
} from "../common/user-ai-settings";
import {providerDisplayName} from "./provider-aliases";
import {AiDownloadedFile} from "./telegram-attachments";
import {isOllamaSpeechToTextModel} from "./speech-to-text-models";
import {createMistralClient, createOllamaClient, createOpenAiClient, resolveAiRuntimeTarget} from "./ai-runtime-target";
import {Environment} from "../common/environment";

export type TranscribedSpeech = {
    provider: AiProvider;
    model: string;
    text: string;
    fileName: string;
};

export type SpeechToTextRequest = {
    provider: AiProvider;
    audio: AiDownloadedFile;
    signal?: AbortSignal;
};

export type SpeechToTextProviderResolution = {
    provider: AiProvider;
    fallback: boolean;
};

export type SpeechToTextResolveOptions = {
    allowFallback?: boolean;
};

export function isTranscribableAudioDownload(download: AiDownloadedFile): boolean {
    if (download.kind === "audio") return true;
    return download.kind === "video-note" && (download.mimeType?.startsWith("audio/") || download.path.toLowerCase().endsWith(".wav"));
}

export function isSpeechToTextConfigured(provider: AiProvider): boolean {
    switch (provider) {
        case AiProvider.OPENAI:
            const openAiTarget = resolveAiRuntimeTarget(provider, "speechToText");
            return !!openAiTarget.apiKey && !!openAiTarget.model;
        case AiProvider.MISTRAL:
            const mistralTarget = resolveAiRuntimeTarget(provider, "speechToText");
            return !!mistralTarget.apiKey && !!mistralTarget.model;
        case AiProvider.OLLAMA:
            const ollamaTarget = resolveAiRuntimeTarget(provider, "speechToText");
            return !!ollamaTarget.baseUrl && isOllamaSpeechToTextModel(ollamaTarget.model);
    }
}

export async function resolveSpeechToTextProviderForUser(
    userId: number,
    preferredProvider?: AiProvider,
    options: SpeechToTextResolveOptions = {},
): Promise<SpeechToTextProviderResolution> {
    const allowFallback = options.allowFallback ?? true;
    const availableChoices = getAvailableAiProviderChoices(userId);
    const allowedProviders = availableChoices
        .map(choice => normalizeAiProviderChoice(choice))
        .filter((choice): choice is AiProvider => !!choice && choice !== "DEFAULT");

    if (preferredProvider) {
        if (!allowedProviders.includes(preferredProvider)) {
            throw new Error(Environment.getProviderNotAvailableForAccessText(providerDisplayName(preferredProvider)));
        }

        if (isSpeechToTextConfigured(preferredProvider)) {
            return {provider: preferredProvider, fallback: false};
        }

        if (!allowFallback) {
            throw new Error(Environment.getProviderSpeechToTextUnsupportedText(providerDisplayName(preferredProvider)));
        }
    }

    const effectiveProvider = await resolveEffectiveAiProviderForUser(userId);
    if (isSpeechToTextConfigured(effectiveProvider)) {
        return {
            provider: effectiveProvider,
            fallback: preferredProvider !== undefined && preferredProvider !== effectiveProvider
        };
    }

    const fallbackProvider = allowedProviders.find(isSpeechToTextConfigured);
    if (!fallbackProvider) {
        throw new Error(Environment.noSpeechToTextProviderForAccessText);
    }

    return {provider: fallbackProvider, fallback: true};
}

export async function transcribeSpeech(request: SpeechToTextRequest): Promise<TranscribedSpeech> {
    if (request.signal?.aborted) throw new Error("Aborted");

    switch (request.provider) {
        case AiProvider.OPENAI:
            return transcribeOpenAiSpeech(request.audio, request.signal);
        case AiProvider.MISTRAL:
            return transcribeMistralSpeech(request.audio, request.signal);
        case AiProvider.OLLAMA:
            return transcribeOllamaSpeech(request.audio, request.signal);
    }
}

export async function transcribeSpeechDownloads(provider: AiProvider, downloads: AiDownloadedFile[], signal?: AbortSignal): Promise<string> {
    const audios = downloads.filter(isTranscribableAudioDownload);
    const transcriptions: string[] = [];

    for (const [index, audio] of audios.entries()) {
        if (signal?.aborted) throw new Error("Aborted");

        const result = await transcribeSpeech({provider, audio, signal});
        const text = result.text.trim();
        if (!text) continue;

        transcriptions.push(audios.length > 1
            ? `[${index + 1}. ${audio.fileName}]\n${text}`
            : text);
    }

    return transcriptions.join("\n\n").trim();
}

async function transcribeOpenAiSpeech(audio: AiDownloadedFile, signal?: AbortSignal): Promise<TranscribedSpeech> {
    const target = resolveAiRuntimeTarget(AiProvider.OPENAI, "speechToText");
    const openAi = createOpenAiClient(target);
    const file = fs.createReadStream(audio.path);
    try {
        const result = await openAi.audio.transcriptions.create({
            file,
            model: target.model,
        }, {signal});

        return {
            provider: AiProvider.OPENAI,
            model: target.model,
            text: result.text || "",
            fileName: audio.fileName,
        };
    } finally {
        file.destroy();
    }
}

async function transcribeMistralSpeech(audio: AiDownloadedFile, signal?: AbortSignal): Promise<TranscribedSpeech> {
    const target = resolveAiRuntimeTarget(AiProvider.MISTRAL, "speechToText");
    const mistralAi = createMistralClient(target);
    const result = await mistralAi.audio.transcriptions.complete({
        model: target.model,
        file: await openAsBlob(audio.path),
    }, {signal});

    return {
        provider: AiProvider.MISTRAL,
        model: target.model,
        text: result.text || "",
        fileName: audio.fileName,
    };
}

async function transcribeOllamaSpeech(audio: AiDownloadedFile, signal?: AbortSignal): Promise<TranscribedSpeech> {
    if (signal?.aborted) throw new Error("Aborted");

    const target = resolveAiRuntimeTarget(AiProvider.OLLAMA, "speechToText");
    const model = target.model;
    if (!isOllamaSpeechToTextModel(model)) {
        throw new Error(Environment.ollamaSpeechToTextModelRequiredText);
    }

    const ollama = createOllamaClient(target);
    const response = await ollama.chat({
        model,
        stream: false,
        think: false,
        messages: [{
            role: "user",
            content: "Transcribe the attached audio verbatim. Reply only with the transcription text. Do not answer the speaker.",
            images: [audio.buffer.toString("base64")],
        }],
        options: {
            temperature: 0,
        },
    });

    return {
        provider: AiProvider.OLLAMA,
        model,
        text: response?.message?.content || "",
        fileName: audio.fileName,
    };
}
