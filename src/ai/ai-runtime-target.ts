import {Mistral} from "@mistralai/mistralai";
import {Ollama} from "ollama";
import {OpenAI} from "openai";
import {Environment} from "../common/environment.js";
import {AiModelCapabilities} from "../model/ai-model-capabilities.js";
import {AiProvider} from "../model/ai-provider.js";

export type AiCapabilityName = keyof AiModelCapabilities;
export type AiRuntimePurpose = AiCapabilityName | "chat";

export type AiRuntimeTarget = {
    provider: AiProvider;
    purpose: AiRuntimePurpose;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    systemPromptAdditions?: string | null;
};

const PURPOSE_SUFFIXES: Record<AiRuntimePurpose, string[]> = {
    chat: ["CHAT"],
    vision: ["VISION", "IMAGE"],
    ocr: ["OCR", "VISION", "IMAGE"],
    thinking: ["THINKING", "THINK"],
    extendedThinking: ["EXTENDED_THINKING", "THINKING", "THINK"],
    tools: ["TOOLS", "CHAT"],
    toolRank: ["TOOL_RANK", "TOOL_RANKER"],
    audio: ["AUDIO"],
    documents: ["DOCUMENTS", "RAG", "EMBEDDING"],
    outputImages: ["OUTPUT_IMAGES", "IMAGE"],
    speechToText: ["SPEECH_TO_TEXT", "TRANSCRIPTION", "STT", "AUDIO"],
    textToSpeech: ["TEXT_TO_SPEECH", "TTS"],
};

function providerPrefix(provider: AiProvider): string {
    return provider.toString();
}

function env(name: string): string | undefined {
    return Environment.getOptionalConfigValue(name);
}

function firstEnv(names: string[]): string | undefined {
    for (const name of names) {
        const value = env(name);
        if (value) return value;
    }

    return undefined;
}

function endpointEnvNames(provider: AiProvider, purpose: AiRuntimePurpose): string[] {
    const prefix = providerPrefix(provider);
    return PURPOSE_SUFFIXES[purpose].flatMap(suffix => [
        `${prefix}_${suffix}_BASE_URL`,
        `${prefix}_${suffix}_ENDPOINT`,
        `${prefix}_${suffix}_ADDRESS`,
    ]);
}

function apiKeyEnvNames(provider: AiProvider, purpose: AiRuntimePurpose): string[] {
    const prefix = providerPrefix(provider);
    return PURPOSE_SUFFIXES[purpose].map(suffix => `${prefix}_${suffix}_API_KEY`);
}

function modelEnvNames(provider: AiProvider, purpose: AiRuntimePurpose): string[] {
    const prefix = providerPrefix(provider);
    return PURPOSE_SUFFIXES[purpose].map(suffix => `${prefix}_${suffix}_MODEL`);
}

function systemPromptEnvNames(provider: AiProvider, purpose: AiRuntimePurpose): string[] {
    const prefix = providerPrefix(provider);
    return PURPOSE_SUFFIXES[purpose].flatMap(suffix => [
        `${prefix}_${suffix}_SYSTEM_PROMPT_ADDITIONS`,
        `${prefix}_${suffix}_SYSTEM_PROMPT`,
    ]);
}

export function getProviderBaseUrl(provider: AiProvider): string | undefined {
    switch (provider) {
        case AiProvider.OLLAMA:
            return env("OLLAMA_ADDRESS");
        case AiProvider.MISTRAL:
            return env("MISTRAL_BASE_URL") ?? env("MISTRAL_ENDPOINT");
        case AiProvider.OPENAI:
            return env("OPENAI_BASE_URL") ?? env("OPENAI_ENDPOINT");
    }
}

export function getProviderApiKey(provider: AiProvider): string | undefined {
    switch (provider) {
        case AiProvider.OLLAMA:
            return Environment.OLLAMA_API_KEY;
        case AiProvider.MISTRAL:
            return Environment.MISTRAL_API_KEY;
        case AiProvider.OPENAI:
            return Environment.OPENAI_API_KEY;
    }
}

export function getDefaultModelForPurpose(provider: AiProvider, purpose: AiRuntimePurpose): string {
    switch (provider) {
        case AiProvider.OLLAMA:
            switch (purpose) {
                case "vision":
                case "ocr":
                case "outputImages":
                    return Environment.OLLAMA_IMAGE_MODEL;
                case "thinking":
                case "extendedThinking":
                    return Environment.OLLAMA_THINK_MODEL;
                case "audio":
                case "speechToText":
                    return Environment.OLLAMA_AUDIO_MODEL;
                case "documents":
                    return Environment.OLLAMA_EMBEDDING_MODEL;
                default:
                    return Environment.OLLAMA_CHAT_MODEL;
            }
        case AiProvider.MISTRAL:
            switch (purpose) {
                case "speechToText":
                    return Environment.MISTRAL_TRANSCRIPTION_MODEL;
                case "textToSpeech":
                    return Environment.MISTRAL_TTS_MODEL || Environment.MISTRAL_MODEL;
                default:
                    return Environment.MISTRAL_MODEL;
            }
        case AiProvider.OPENAI:
            switch (purpose) {
                case "outputImages":
                    return Environment.OPENAI_IMAGE_MODEL;
                case "speechToText":
                    return Environment.OPENAI_TRANSCRIPTION_MODEL;
                case "textToSpeech":
                    return Environment.OPENAI_TTS_MODEL;
                default:
                    return Environment.OPENAI_MODEL;
            }
    }
}

export function resolveAiRuntimeTarget(
    provider: AiProvider,
    purpose: AiRuntimePurpose,
    modelOverride?: string,
): AiRuntimeTarget {
    const model = modelOverride
        ?? firstEnv(modelEnvNames(provider, purpose))
        ?? getDefaultModelForPurpose(provider, purpose);
    const baseUrl = firstEnv(endpointEnvNames(provider, purpose)) ?? getProviderBaseUrl(provider);
    const apiKey = firstEnv(apiKeyEnvNames(provider, purpose)) ?? getProviderApiKey(provider);
    const systemPromptAdditions = firstEnv(systemPromptEnvNames(provider, purpose));

    return {provider, purpose, model, baseUrl, apiKey, systemPromptAdditions};
}

export function sameRuntimeEndpoint(left: AiRuntimeTarget, right: AiRuntimeTarget): boolean {
    return left.provider === right.provider
        && (left.baseUrl ?? "") === (right.baseUrl ?? "")
        && (left.apiKey ?? "") === (right.apiKey ?? "");
}

export function createOpenAiClient(target: AiRuntimeTarget): OpenAI {
    return new OpenAI({
        apiKey: target.apiKey,
        baseURL: target.baseUrl,
    });
}

export function createMistralClient(target: AiRuntimeTarget): Mistral {
    return new Mistral({
        apiKey: target.apiKey,
        serverURL: target.baseUrl,
    });
}

export function createOllamaClient(target: AiRuntimeTarget): Ollama {
    return new Ollama({
        host: target.baseUrl,
        headers: target.apiKey ? {"Authorization": `Bearer ${target.apiKey}`} : undefined,
    });
}
