import {AiProvider} from "../model/ai-provider";

export const AI_REGENERATE_CALLBACK = "/regenerate_ai";

export type AiRegenerateCallbackData = {
    provider: AiProvider;
    think: boolean;
};

export function buildAiRegenerateCallbackData(provider: AiProvider, think = false): string {
    return `${AI_REGENERATE_CALLBACK} ${provider} ${think ? "1" : "0"}`;
}

export function parseAiRegenerateCallbackData(data: string): AiRegenerateCallbackData | null {
    if (!data.startsWith(AI_REGENERATE_CALLBACK)) return null;

    const [, provider, think] = data.split(/\s+/);
    if (!Object.values(AiProvider).includes(provider as AiProvider)) return null;

    return {
        provider: provider as AiProvider,
        think: think === "1" || think === "true",
    };
}
