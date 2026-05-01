import {Environment} from "./environment";
import {UserStore} from "./user-store";
import {AiProvider} from "../model/ai-provider";
import {StoredUser} from "../model/stored-user";
import {resolveAiRuntimeTarget} from "../ai/ai-runtime-target";
import {DEFAULT_LANGUAGE_CHOICE, LanguageChoice, Localization,} from "./localization";

export const DEFAULT_AI_PROVIDER_CHOICE = "DEFAULT";
export const DEFAULT_AI_CONTEXT_SIZE_CHOICE = "DEFAULT";
export const AI_CONTEXT_SIZE_MAX_CHOICE = "MAX";
export const USER_AI_CONTEXT_SIZE_PRESETS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144] as const;
export const MIN_USER_AI_CONTEXT_SIZE = 1024;
export const MAX_USER_AI_CONTEXT_SIZE = 1_000_000;
export const AI_VOICE_MODE_EXECUTE = "execute";
export const AI_VOICE_MODE_TRANSCRIPT = "transcript";
export const AI_IMAGE_OUTPUT_MODE_PHOTO = "photo";
export const AI_IMAGE_OUTPUT_MODE_DOCUMENT = "document";
export type UserAiProviderChoice = AiProvider | typeof DEFAULT_AI_PROVIDER_CHOICE;
export type UserAiContextSizeChoice = number | typeof DEFAULT_AI_CONTEXT_SIZE_CHOICE | typeof AI_CONTEXT_SIZE_MAX_CHOICE;
export type UserAiVoiceMode = typeof AI_VOICE_MODE_EXECUTE | typeof AI_VOICE_MODE_TRANSCRIPT;
export type UserAiImageOutputMode = typeof AI_IMAGE_OUTPUT_MODE_PHOTO | typeof AI_IMAGE_OUTPUT_MODE_DOCUMENT;
export type UserInterfaceLanguage = LanguageChoice;
export type UserAiResponseLanguage = LanguageChoice;
export type UserTier = "creator" | "admin" | "user";

export type EffectiveUserAiSettings = {
    userId: number;
    tier: UserTier;
    providerChoice: UserAiProviderChoice;
    effectiveProvider: AiProvider;
    interfaceLanguage: UserInterfaceLanguage;
    responseLanguage: UserAiResponseLanguage;
    contextSizeChoice: UserAiContextSizeChoice;
    contextSize?: number;
    voiceMode: UserAiVoiceMode;
    imageOutputMode: UserAiImageOutputMode;
    availableProviderChoices: UserAiProviderChoice[];
    availableContextSizeChoices: UserAiContextSizeChoice[];
    availableVoiceModes: UserAiVoiceMode[];
    availableImageOutputModes: UserAiImageOutputMode[];
};

const CREATOR_PROVIDERS: readonly AiProvider[] = [
    AiProvider.OLLAMA,
    AiProvider.MISTRAL,
    AiProvider.OPENAI,
];

const ADMIN_PROVIDERS: readonly AiProvider[] = [
    AiProvider.MISTRAL,
    AiProvider.OPENAI,
];

const USER_PROVIDERS: readonly AiProvider[] = [
    AiProvider.MISTRAL,
    AiProvider.OLLAMA,
];

export const DEFAULT_INTERFACE_LANGUAGE: UserInterfaceLanguage = DEFAULT_LANGUAGE_CHOICE;
export const DEFAULT_AI_RESPONSE_LANGUAGE: UserAiResponseLanguage = DEFAULT_LANGUAGE_CHOICE;
export const DEFAULT_AI_VOICE_MODE: UserAiVoiceMode = AI_VOICE_MODE_EXECUTE;
export const DEFAULT_AI_IMAGE_OUTPUT_MODE: UserAiImageOutputMode = AI_IMAGE_OUTPUT_MODE_PHOTO;

export function getUserLanguageChoices(): string[] {
    return Localization.languageChoices();
}

export function getUserAiContextSizeChoices(): UserAiContextSizeChoice[] {
    return [DEFAULT_AI_CONTEXT_SIZE_CHOICE, ...USER_AI_CONTEXT_SIZE_PRESETS, AI_CONTEXT_SIZE_MAX_CHOICE];
}

export function getUserAiVoiceModes(): UserAiVoiceMode[] {
    return [AI_VOICE_MODE_EXECUTE, AI_VOICE_MODE_TRANSCRIPT];
}

export function getUserAiImageOutputModes(): UserAiImageOutputMode[] {
    return [AI_IMAGE_OUTPUT_MODE_PHOTO, AI_IMAGE_OUTPUT_MODE_DOCUMENT];
}

export function getUserTier(userId: number): UserTier {
    if (userId === Environment.CREATOR_ID) return "creator";
    if (Environment.ADMIN_IDS.has(userId)) return "admin";
    return "user";
}

function allowedProvidersForTier(tier: UserTier): readonly AiProvider[] {
    switch (tier) {
        case "creator":
            return CREATOR_PROVIDERS;
        case "admin":
            return ADMIN_PROVIDERS;
        case "user":
            return USER_PROVIDERS;
    }
}

export function isAiProviderConfigured(provider: AiProvider): boolean {
    const target = resolveAiRuntimeTarget(provider, "chat");

    switch (provider) {
        case AiProvider.OLLAMA:
            return !!target.baseUrl && !!target.model;
        case AiProvider.MISTRAL:
            return !!target.apiKey && !!target.model;
        case AiProvider.OPENAI:
            return !!target.apiKey && !!target.model;
    }
}

export function getAvailableAiProviderChoices(userId: number): UserAiProviderChoice[] {
    const tier = getUserTier(userId);
    const providers = allowedProvidersForTier(tier).filter(isAiProviderConfigured);
    return [DEFAULT_AI_PROVIDER_CHOICE, ...providers];
}

export function normalizeAiProviderChoice(value: string | undefined | null): UserAiProviderChoice | undefined {
    if (!value) return undefined;
    if (value === DEFAULT_AI_PROVIDER_CHOICE) return DEFAULT_AI_PROVIDER_CHOICE;

    const providers = Object.values(AiProvider) as string[];
    return providers.includes(value) ? value as AiProvider : undefined;
}

export function normalizeAiContextSizeChoice(value: string | number | undefined | null): UserAiContextSizeChoice | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    let numericValue: number;

    if (typeof value === "string") {
        const normalized = value.trim();
        const lower = normalized.toLowerCase();
        if (normalized === DEFAULT_AI_CONTEXT_SIZE_CHOICE || lower === "default" || lower === "auto") {
            return DEFAULT_AI_CONTEXT_SIZE_CHOICE;
        }

        if (normalized === AI_CONTEXT_SIZE_MAX_CHOICE || lower === "max") {
            return AI_CONTEXT_SIZE_MAX_CHOICE;
        }

        numericValue = Number(normalized);
    } else {
        numericValue = value;
    }

    if (numericValue === -1) {
        return AI_CONTEXT_SIZE_MAX_CHOICE;
    }

    if (!Number.isSafeInteger(numericValue) || numericValue < MIN_USER_AI_CONTEXT_SIZE || numericValue > MAX_USER_AI_CONTEXT_SIZE) {
        return undefined;
    }

    return numericValue;
}

export function normalizeAiVoiceMode(value: string | undefined | null): UserAiVoiceMode | undefined {
    if (!value) return undefined;

    switch (value.trim().toLowerCase()) {
        case AI_VOICE_MODE_EXECUTE:
        case "command":
        case "commands":
        case "ai":
            return AI_VOICE_MODE_EXECUTE;
        case AI_VOICE_MODE_TRANSCRIPT:
        case "transcribe":
        case "transcription":
        case "text":
            return AI_VOICE_MODE_TRANSCRIPT;
        default:
            return undefined;
    }
}

export function normalizeAiImageOutputMode(value: string | undefined | null): UserAiImageOutputMode | undefined {
    if (!value) return undefined;

    switch (value.trim().toLowerCase()) {
        case AI_IMAGE_OUTPUT_MODE_PHOTO:
        case "photo":
        case "photos":
        case "image":
        case "images":
            return AI_IMAGE_OUTPUT_MODE_PHOTO;
        case AI_IMAGE_OUTPUT_MODE_DOCUMENT:
        case "doc":
        case "docs":
        case "file":
        case "files":
            return AI_IMAGE_OUTPUT_MODE_DOCUMENT;
        default:
            return undefined;
    }
}

export function normalizeUserLanguageChoice(value: string | undefined | null): UserInterfaceLanguage | undefined {
    if (!value) return undefined;
    if (value === DEFAULT_LANGUAGE_CHOICE) return DEFAULT_LANGUAGE_CHOICE;

    const normalized = Localization.normalizeLocale(value);
    return normalized && Localization.isKnownLanguageChoice(normalized)
        ? normalized
        : undefined;
}

export function normalizeInterfaceLanguage(value: string | undefined | null): UserInterfaceLanguage | undefined {
    return normalizeUserLanguageChoice(value);
}

export function normalizeAiResponseLanguage(value: string | undefined | null): UserAiResponseLanguage | undefined {
    return normalizeUserLanguageChoice(value);
}

export function getProviderChoiceLabel(choice: UserAiProviderChoice): string {
    if (choice === DEFAULT_AI_PROVIDER_CHOICE) {
        return Localization.text("providerChoice.default", {}, "Default");
    }

    return choice.charAt(0) + choice.slice(1).toLowerCase();
}

export function getResponseLanguageLabel(language: UserAiResponseLanguage): string {
    return Localization.languageLabel(language);
}

export function getContextSizeLabel(choice: UserAiContextSizeChoice): string {
    if (choice === DEFAULT_AI_CONTEXT_SIZE_CHOICE) {
        return Environment.userSettingsContextSizeDefaultText;
    }

    if (choice === AI_CONTEXT_SIZE_MAX_CHOICE) {
        return Environment.userSettingsContextSizeMaxText;
    }

    return Environment.getUserSettingsContextSizeText(choice);
}

export function getVoiceModeLabel(mode: UserAiVoiceMode): string {
    switch (mode) {
        case AI_VOICE_MODE_EXECUTE:
            return Environment.userSettingsVoiceModeExecuteText;
        case AI_VOICE_MODE_TRANSCRIPT:
            return Environment.userSettingsVoiceModeTranscriptText;
    }
}

export function getImageOutputModeLabel(mode: UserAiImageOutputMode): string {
    switch (mode) {
        case AI_IMAGE_OUTPUT_MODE_PHOTO:
            return Environment.userSettingsImageOutputPhotoText;
        case AI_IMAGE_OUTPUT_MODE_DOCUMENT:
            return Environment.userSettingsImageOutputDocumentText;
    }
}

export function getInterfaceLanguageLabel(language: UserInterfaceLanguage): string {
    return Localization.languageLabel(language);
}

export function getResponseLanguageInstruction(language: UserAiResponseLanguage): string {
    const instructions = [
        "Language:"
    ];

    if (language === DEFAULT_LANGUAGE_CHOICE) {
        instructions.push("Always answer in the language of the user’s latest message unless explicitly asked otherwise.");
    } else {
        instructions.push(`Always answer to the user in ${Localization.languageInstructionName(language)}. If the user specifically requests another language, comply with that request.`);
    }

    return instructions.join("\n");
}

function shouldUpdateInterfaceLanguage(user: StoredUser | null, language: UserInterfaceLanguage): boolean {
    return !!user?.interfaceLanguage && user.interfaceLanguage !== language;
}

function shouldUpdateProvider(user: StoredUser | null, choice: UserAiProviderChoice): boolean {
    return !!user?.aiProvider && user.aiProvider !== choice;
}

function shouldUpdateLanguage(user: StoredUser | null, language: UserAiResponseLanguage): boolean {
    return !!user?.aiResponseLanguage && user.aiResponseLanguage !== language;
}

function shouldUpdateContextSize(user: StoredUser | null, choice: UserAiContextSizeChoice): boolean {
    if (!user) return false;
    if (choice === DEFAULT_AI_CONTEXT_SIZE_CHOICE && user.aiContextSize === undefined) return false;
    return normalizeAiContextSizeChoice(user.aiContextSize) !== choice;
}

function shouldUpdateVoiceMode(user: StoredUser | null, mode: UserAiVoiceMode): boolean {
    return !!user?.aiVoiceMode && user.aiVoiceMode !== mode;
}

function shouldUpdateImageOutputMode(user: StoredUser | null, mode: UserAiImageOutputMode): boolean {
    return !!user?.aiImageOutputMode && user.aiImageOutputMode !== mode;
}

function contextSizeChoiceToStored(choice: UserAiContextSizeChoice): number | undefined {
    return choice === DEFAULT_AI_CONTEXT_SIZE_CHOICE ? undefined : choice === AI_CONTEXT_SIZE_MAX_CHOICE ? -1 : choice;
}

export async function ensureValidUserAiSettings(userId: number): Promise<EffectiveUserAiSettings> {
    const user = await UserStore.get(userId);
    const availableProviderChoices = getAvailableAiProviderChoices(userId);
    let availableContextSizeChoices = getUserAiContextSizeChoices();
    const availableVoiceModes = getUserAiVoiceModes();
    let providerChoice = normalizeAiProviderChoice(user?.aiProvider) ?? DEFAULT_AI_PROVIDER_CHOICE;
    let interfaceLanguage = normalizeInterfaceLanguage(user?.interfaceLanguage) ?? DEFAULT_INTERFACE_LANGUAGE;
    let responseLanguage = normalizeAiResponseLanguage(user?.aiResponseLanguage) ?? DEFAULT_AI_RESPONSE_LANGUAGE;
    let contextSizeChoice = normalizeAiContextSizeChoice(user?.aiContextSize) ?? DEFAULT_AI_CONTEXT_SIZE_CHOICE;
    let voiceMode = normalizeAiVoiceMode(user?.aiVoiceMode) ?? DEFAULT_AI_VOICE_MODE;
    let imageOutputMode = normalizeAiImageOutputMode(user?.aiImageOutputMode) ?? DEFAULT_AI_IMAGE_OUTPUT_MODE;

    if (!availableProviderChoices.includes(providerChoice)) {
        providerChoice = availableProviderChoices[0] ?? DEFAULT_AI_PROVIDER_CHOICE;
    }

    if (!Localization.isKnownLanguageChoice(interfaceLanguage)) {
        interfaceLanguage = DEFAULT_INTERFACE_LANGUAGE;
    }

    if (!Localization.isKnownLanguageChoice(responseLanguage)) {
        responseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE;
    }

    if (contextSizeChoice !== DEFAULT_AI_CONTEXT_SIZE_CHOICE && !normalizeAiContextSizeChoice(contextSizeChoice)) {
        contextSizeChoice = DEFAULT_AI_CONTEXT_SIZE_CHOICE;
    }

    if (!availableContextSizeChoices.includes(contextSizeChoice)) {
        availableContextSizeChoices = [
            DEFAULT_AI_CONTEXT_SIZE_CHOICE,
            ...[
                ...availableContextSizeChoices.filter(choice => choice !== DEFAULT_AI_CONTEXT_SIZE_CHOICE),
                contextSizeChoice,
            ].sort((a, b) => Number(a) - Number(b)),
        ];
    }

    if (!availableVoiceModes.includes(voiceMode)) {
        voiceMode = DEFAULT_AI_VOICE_MODE;
    }

    if (!getUserAiImageOutputModes().includes(imageOutputMode)) {
        imageOutputMode = DEFAULT_AI_IMAGE_OUTPUT_MODE;
    }

    if (
        shouldUpdateProvider(user, providerChoice)
        || shouldUpdateInterfaceLanguage(user, interfaceLanguage)
        || shouldUpdateLanguage(user, responseLanguage)
        || shouldUpdateContextSize(user, contextSizeChoice)
        || shouldUpdateVoiceMode(user, voiceMode)
        || shouldUpdateImageOutputMode(user, imageOutputMode)
    ) {
        await UserStore.updateSettings(userId, {
            interfaceLanguage,
            aiProvider: providerChoice,
            aiResponseLanguage: responseLanguage,
            aiContextSize: contextSizeChoiceToStored(contextSizeChoice),
            aiVoiceMode: voiceMode,
            aiImageOutputMode: imageOutputMode,
        });
    }

    return {
        userId,
        tier: getUserTier(userId),
        providerChoice,
        effectiveProvider: providerChoice === DEFAULT_AI_PROVIDER_CHOICE ? Environment.DEFAULT_AI_PROVIDER : providerChoice,
        interfaceLanguage,
        responseLanguage,
        contextSizeChoice,
        contextSize: contextSizeChoiceToStored(contextSizeChoice),
        voiceMode,
        imageOutputMode,
        availableProviderChoices,
        availableContextSizeChoices,
        availableVoiceModes,
        availableImageOutputModes: getUserAiImageOutputModes(),
    };
}

export async function resolveEffectiveAiProviderForUser(userId: number | undefined): Promise<AiProvider> {
    if (!userId) return Environment.DEFAULT_AI_PROVIDER;
    return (await ensureValidUserAiSettings(userId)).effectiveProvider;
}

export async function resolveAiResponseLanguageForUser(userId: number | undefined): Promise<UserAiResponseLanguage> {
    if (!userId) return DEFAULT_AI_RESPONSE_LANGUAGE;
    return (await ensureValidUserAiSettings(userId)).responseLanguage;
}

export async function resolveAiContextSizeForUser(userId: number | undefined): Promise<number | undefined> {
    if (!userId) return undefined;
    return (await ensureValidUserAiSettings(userId)).contextSize;
}

export async function resolveAiVoiceModeForUser(userId: number | undefined): Promise<UserAiVoiceMode> {
    if (!userId) return DEFAULT_AI_VOICE_MODE;
    return (await ensureValidUserAiSettings(userId)).voiceMode;
}

export async function resolveAiImageOutputModeForUser(userId: number | undefined): Promise<UserAiImageOutputMode> {
    if (!userId) return DEFAULT_AI_IMAGE_OUTPUT_MODE;
    return (await ensureValidUserAiSettings(userId)).imageOutputMode;
}

export async function resolveInterfaceLocaleForUser(
    userId: number | undefined,
    telegramLanguageCode?: string,
): Promise<string> {
    if (!userId) {
        return Localization.resolveLocale(DEFAULT_INTERFACE_LANGUAGE, telegramLanguageCode);
    }

    const settings = await ensureValidUserAiSettings(userId);
    const user = await UserStore.get(userId);
    return Localization.resolveLocale(settings.interfaceLanguage, telegramLanguageCode ?? user?.langCode);
}

export async function setUserAiProviderChoice(
    userId: number,
    choice: UserAiProviderChoice,
): Promise<{ ok: boolean; settings: EffectiveUserAiSettings }> {
    const settings = await ensureValidUserAiSettings(userId);

    if (!settings.availableProviderChoices.includes(choice)) {
        return {ok: false, settings};
    }

    await UserStore.updateSettings(userId, {
        interfaceLanguage: settings.interfaceLanguage,
        aiProvider: choice,
        aiResponseLanguage: settings.responseLanguage,
    });

    return {ok: true, settings: await ensureValidUserAiSettings(userId)};
}

export async function setUserAiContextSizeChoice(
    userId: number,
    choice: UserAiContextSizeChoice,
): Promise<{ ok: boolean; settings: EffectiveUserAiSettings }> {
    const settings = await ensureValidUserAiSettings(userId);
    const normalized = normalizeAiContextSizeChoice(choice);

    if (!normalized && normalized !== -1) {
        return {ok: false, settings};
    }

    await UserStore.updateSettings(userId, {
        aiContextSize: contextSizeChoiceToStored(normalized),
    });

    return {ok: true, settings: await ensureValidUserAiSettings(userId)};
}

export async function setUserAiVoiceMode(
    userId: number,
    mode: UserAiVoiceMode,
): Promise<{ ok: boolean; settings: EffectiveUserAiSettings }> {
    const settings = await ensureValidUserAiSettings(userId);

    if (!getUserAiVoiceModes().includes(mode)) {
        return {ok: false, settings};
    }

    await UserStore.updateSettings(userId, {
        aiVoiceMode: mode,
    });

    return {ok: true, settings: await ensureValidUserAiSettings(userId)};
}

export async function setUserAiImageOutputMode(
    userId: number,
    mode: UserAiImageOutputMode,
): Promise<{ ok: boolean; settings: EffectiveUserAiSettings }> {
    const settings = await ensureValidUserAiSettings(userId);

    if (!getUserAiImageOutputModes().includes(mode)) {
        return {ok: false, settings};
    }

    await UserStore.updateSettings(userId, {
        aiImageOutputMode: mode,
    });

    return {ok: true, settings: await ensureValidUserAiSettings(userId)};
}

export async function setUserAiResponseLanguage(
    userId: number,
    language: UserAiResponseLanguage,
): Promise<{ ok: boolean; settings: EffectiveUserAiSettings }> {
    const settings = await ensureValidUserAiSettings(userId);

    if (!Localization.isKnownLanguageChoice(language)) {
        return {ok: false, settings};
    }

    await UserStore.updateSettings(userId, {
        interfaceLanguage: settings.interfaceLanguage,
        aiProvider: settings.providerChoice,
        aiResponseLanguage: language,
    });

    return {ok: true, settings: await ensureValidUserAiSettings(userId)};
}

export async function setUserInterfaceLanguage(
    userId: number,
    language: UserInterfaceLanguage,
): Promise<{ ok: boolean; settings: EffectiveUserAiSettings }> {
    const settings = await ensureValidUserAiSettings(userId);

    if (!Localization.isKnownLanguageChoice(language)) {
        return {ok: false, settings};
    }

    await UserStore.updateSettings(userId, {
        interfaceLanguage: language,
        aiProvider: settings.providerChoice,
        aiResponseLanguage: settings.responseLanguage,
    });

    return {ok: true, settings: await ensureValidUserAiSettings(userId)};
}
