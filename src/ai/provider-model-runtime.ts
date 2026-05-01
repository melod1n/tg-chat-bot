import {AiProvider} from "../model/ai-provider";
import {AiModelCapabilities} from "../model/ai-model-capabilities";
import {Environment} from "../common/environment";
import {logError} from "../util/utils";
import {AiCapabilityInfo} from "../model/ai-capability-info";
import {isOllamaSpeechToTextModel} from "./speech-to-text-models";
import {
    AiCapabilityName,
    AiRuntimeTarget,
    createMistralClient,
    createOllamaClient,
    createOpenAiClient,
    resolveAiRuntimeTarget,
    sameRuntimeEndpoint,
} from "./ai-runtime-target";

const CAPABILITY_NAMES: AiCapabilityName[] = [
    "chat",
    "vision",
    "ocr",
    "thinking",
    "extendedThinking",
    "tools",
    "audio",
    "documents",
    "outputImages",
    "speechToText",
    "textToSpeech",
];

export function getRuntimeModel(provider: AiProvider): string {
    switch (provider) {
        case AiProvider.OLLAMA:
            return Environment.OLLAMA_CHAT_MODEL;
        case AiProvider.MISTRAL:
            return Environment.MISTRAL_MODEL;
        case AiProvider.OPENAI:
            return Environment.OPENAI_MODEL;
    }
}

export function setRuntimeModel(provider: AiProvider, model: string): void {
    switch (provider) {
        case AiProvider.OLLAMA:
            Environment.OLLAMA_CHAT_MODEL = model;
            break;
        case AiProvider.MISTRAL:
            Environment.MISTRAL_MODEL = model;
            break;
        case AiProvider.OPENAI:
            Environment.OPENAI_MODEL = model;
            break;
    }
}

function capability(supported: boolean, target?: AiRuntimeTarget, runtimeTarget?: AiRuntimeTarget): AiCapabilityInfo {
    const result: AiCapabilityInfo = {supported};
    if (target?.model) result.model = target.model;
    if (target) {
        result.endpoint = {
            provider: target.provider,
            baseUrl: target.baseUrl,
            external: runtimeTarget ? !sameRuntimeEndpoint(target, runtimeTarget) : false,
        };
    }
    if (target && runtimeTarget && (target.model !== runtimeTarget.model || !sameRuntimeEndpoint(target, runtimeTarget))) {
        result.external = true;
    }
    return result;
}

function buildCapabilities(overrides: Partial<Record<AiCapabilityName, AiCapabilityInfo>>): AiModelCapabilities {
    return Object.assign(new AiModelCapabilities(), {
        chat: {supported: false},
        vision: {supported: false},
        ocr: {supported: false},
        thinking: {supported: false},
        extendedThinking: {supported: false},
        tools: {supported: false},
        audio: {supported: false},
        documents: {supported: false},
        outputImages: {supported: false},
        speechToText: {supported: false},
        textToSpeech: {supported: false},
        ...overrides,
    });
}

function lowerModelName(model: string): string {
    return model.toLowerCase();
}

function isOpenAiTextModel(model: string): boolean {
    const name = lowerModelName(model);
    if (!name) return false;
    if (/^(gpt-image|dall-e|tts-|whisper|text-embedding|text-moderation|omni-moderation)/.test(name)) return false;
    if (name.includes("transcribe")) return false;
    return /^(gpt-|o\d|chatgpt-|codex-|computer-use)/.test(name);
}

function isOpenAiReasoningModel(model: string): boolean {
    const name = lowerModelName(model);
    return /^o\d/.test(name) || name.startsWith("gpt-5");
}

function isOpenAiVisionModel(model: string): boolean {
    const name = lowerModelName(model);
    if (!isOpenAiTextModel(model)) return false;
    if (name.startsWith("gpt-3.5")) return false;
    if (name.includes("audio-preview") || name.includes("search-preview")) return false;
    return true;
}

export async function getModelCapabilities(
    provider: AiProvider,
    model: string,
    purpose: AiCapabilityName | "chat" = "chat",
): Promise<AiModelCapabilities | undefined> {
    if (!model) return undefined;

    try {
        const runtimeTarget = resolveAiRuntimeTarget(provider, "chat", getRuntimeModel(provider));
        const target = resolveAiRuntimeTarget(provider, purpose, model);

        switch (provider) {
            case AiProvider.OLLAMA: {
                const ollama = createOllamaClient(target);
                const info = await ollama.show({model});
                const modelCapabilities = Array.isArray(info.capabilities) ? info.capabilities : [];
                const has = (cap: string): boolean => modelCapabilities.includes(cap);
                const audioSupported = isOllamaSpeechToTextModel(model);
                const documentsTarget = resolveAiRuntimeTarget(provider, "documents");

                return buildCapabilities({
                    chat: capability(true, target, runtimeTarget),
                    vision: capability(has("vision"), target, runtimeTarget),
                    ocr: capability(has("ocr"), target, runtimeTarget),
                    thinking: capability(has("thinking"), target, runtimeTarget),
                    extendedThinking: capability(has("thinking") && model.includes("gpt-oss"), target, runtimeTarget),
                    tools: capability(has("tools"), target, runtimeTarget),
                    audio: capability(audioSupported, target, runtimeTarget),
                    documents: capability(!!documentsTarget.model, documentsTarget, runtimeTarget),
                    speechToText: capability(audioSupported, target, runtimeTarget),
                });
            }
            case AiProvider.MISTRAL: {
                const mistral = createMistralClient(target);
                const info = await mistral.models.retrieve({modelId: model});
                const caps = info.type !== "UNKNOWN" ? info.capabilities : undefined;
                const speechTarget = resolveAiRuntimeTarget(provider, "speechToText");
                const ttsTarget = resolveAiRuntimeTarget(provider, "textToSpeech");

                return buildCapabilities({
                    chat: capability(true, target, runtimeTarget),
                    vision: capability(!!caps?.vision, target, runtimeTarget),
                    ocr: capability(!!caps?.ocr, target, runtimeTarget),
                    thinking: capability(!!caps?.reasoning, target, runtimeTarget),
                    tools: capability(!!caps?.functionCalling, target, runtimeTarget),
                    audio: capability(!!caps?.audio, target, runtimeTarget),
                    documents: capability(true, target, runtimeTarget),
                    speechToText: capability(!!speechTarget.model || !!caps?.audioTranscription, speechTarget, runtimeTarget),
                    textToSpeech: capability(!!ttsTarget.apiKey && !!ttsTarget.model, ttsTarget, runtimeTarget),
                });
            }
            case AiProvider.OPENAI: {
                const textModel = isOpenAiTextModel(model);
                const reasoningModel = isOpenAiReasoningModel(model);
                const imageTarget = resolveAiRuntimeTarget(provider, "outputImages");
                const speechTarget = resolveAiRuntimeTarget(provider, "speechToText");
                const ttsTarget = resolveAiRuntimeTarget(provider, "textToSpeech");

                return buildCapabilities({
                    chat: capability(true, target, runtimeTarget),
                    vision: capability(isOpenAiVisionModel(model), target, runtimeTarget),
                    ocr: capability(isOpenAiVisionModel(model), target, runtimeTarget),
                    thinking: capability(reasoningModel, target, runtimeTarget),
                    extendedThinking: capability(reasoningModel, target, runtimeTarget),
                    tools: capability(textModel, target, runtimeTarget),
                    documents: capability(textModel, target, runtimeTarget),
                    outputImages: capability(!!imageTarget.model, imageTarget, runtimeTarget),
                    speechToText: capability(!!speechTarget.model, speechTarget, runtimeTarget),
                    textToSpeech: capability(!!ttsTarget.apiKey && !!ttsTarget.model, ttsTarget, runtimeTarget),
                });
            }
        }

    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        return undefined;
    }
}

export async function getRuntimeCapabilities(
    provider: AiProvider = Environment.DEFAULT_AI_PROVIDER,
    model: string | undefined = getRuntimeModel(provider),
    target?: AiRuntimeTarget
): Promise<AiModelCapabilities> {
    const runtimeTarget = target ?? resolveAiRuntimeTarget(provider, "chat", model ?? getRuntimeModel(provider));
        const result = await getModelCapabilities(provider, runtimeTarget.model, target?.purpose ?? "chat") ?? buildCapabilities({});

    for (const capabilityName of CAPABILITY_NAMES) {
        if (provider === AiProvider.OPENAI && (capabilityName === "vision" || capabilityName === "ocr")) {
            continue;
        }

        const target = resolveAiRuntimeTarget(provider, capabilityName);
        if (target.model === runtimeTarget.model && sameRuntimeEndpoint(target, runtimeTarget)) continue;

        const targetCapabilities = await getModelCapabilities(provider, target.model, capabilityName);
        const capabilityInfo = targetCapabilities?.[capabilityName];
        if (capabilityInfo) {
            result[capabilityName] = capabilityInfo;
        }
    }

    return result;
}

export async function getFormattedCapabilities(
    provider: AiProvider = Environment.DEFAULT_AI_PROVIDER,
    model: string | undefined = getRuntimeModel(provider),
    caps?: AiModelCapabilities,
): Promise<string[]> {
    if (!caps) caps = await getRuntimeCapabilities(provider, model);

    const line = (title: string, value?: AiCapabilityInfo) => {
        const state = value?.supported ? "✅" : "❌";
        const external = value?.external ?? (!!value?.model && value.model !== model);
        return Environment.getRuntimeCapabilityLineText({
            state,
            title,
            model: value?.model,
            endpointBaseUrl: value?.endpoint?.baseUrl,
            external,
        });
    };

    return [
        line(Environment.runtimeCapabilityChatText, caps.chat),
        line(Environment.runtimeCapabilityVisionText, caps.vision),
        line(Environment.runtimeCapabilityOcrText, caps.ocr),
        line(Environment.runtimeCapabilityThinkingText, caps.thinking),
        line(Environment.runtimeCapabilityExtendedThinkingText, caps.extendedThinking),
        line(Environment.runtimeCapabilityToolsText, caps.tools),
        line(Environment.runtimeCapabilityAudioText, caps.audio),
        line(Environment.runtimeCapabilitySpeechToTextText, caps.speechToText),
        line(Environment.runtimeCapabilityTextToSpeechText, caps.textToSpeech),
        line(Environment.runtimeCapabilityDocumentsText, caps.documents),
        line(Environment.runtimeCapabilityOutputImagesText, caps.outputImages),
    ];
}

export async function formatRuntimeModelInfo(
    provider: AiProvider = Environment.DEFAULT_AI_PROVIDER,
    model: string | undefined = getRuntimeModel(provider),
    caps?: AiModelCapabilities,
): Promise<string> {
    return Environment.getRuntimeModelInfoText(
        provider.toString().toLowerCase(),
        model,
        await getFormattedCapabilities(provider, model, caps)
    );
}


type NamedModel = {
    id?: string;
    name?: string;
    model?: string;
};

type ModelListResponse = {
    models?: NamedModel[];
    data?: NamedModel[];
};

export async function listProviderModels(provider: AiProvider): Promise<string[]> {
    const target = resolveAiRuntimeTarget(provider, "chat", getRuntimeModel(provider));

        switch (provider) {
            case AiProvider.OLLAMA: {
                const ollama = createOllamaClient(target);
                const result = await ollama.list() as ModelListResponse;
                return (result.models ?? []).map(m => m.model || m.name).filter((name): name is string => !!name);
            }
        case AiProvider.MISTRAL: {
            const mistralAi = createMistralClient(target);
            const result = await mistralAi.models.list() as ModelListResponse | NamedModel[];
            const items = Array.isArray(result) ? result : result.data ?? result.models ?? [];
            return items.map(m => m.id || m.name || String(m)).filter((name): name is string => !!name);
        }
        case AiProvider.OPENAI: {
            const openAi = createOpenAiClient(target);
            const result = await openAi.models.list() as ModelListResponse;
            return (result.data ?? []).map(m => m.id).filter((id): id is string => !!id);
        }
    }
}
