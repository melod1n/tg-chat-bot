import {AiProvider} from "../model/ai-provider";

const PROVIDER_ALIASES = new Map<string, AiProvider>([
    ["openai", AiProvider.OPENAI],
    ["chatgpt", AiProvider.OPENAI],
    ["gpt", AiProvider.OPENAI],
    ["mistral", AiProvider.MISTRAL],
    ["ollama", AiProvider.OLLAMA],
]);

export function parseProviderToken(token: string | undefined): AiProvider | undefined {
    if (!token) return undefined;
    return PROVIDER_ALIASES.get(token.toLowerCase().replace(/:$/, ""));
}

export function providerDisplayName(provider: AiProvider): string {
    return provider.charAt(0) + provider.slice(1).toLowerCase();
}
