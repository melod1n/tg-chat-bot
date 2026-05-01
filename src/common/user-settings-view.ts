import {InlineKeyboardMarkup} from "typescript-telegram-bot-api";
import {Environment} from "./environment";
import {
    DEFAULT_AI_PROVIDER_CHOICE,
    EffectiveUserAiSettings,
    getContextSizeLabel,
    getInterfaceLanguageLabel,
    getProviderChoiceLabel,
    getResponseLanguageLabel,
    getImageOutputModeLabel,
    getVoiceModeLabel,
    getUserLanguageChoices,
    UserAiContextSizeChoice,
    UserAiImageOutputMode,
    UserAiProviderChoice,
    UserAiResponseLanguage,
    UserAiVoiceMode,
    UserInterfaceLanguage,
} from "./user-ai-settings";

export const USER_SETTINGS_CALLBACK_PREFIX = "/settings";

export type UserSettingsScreen = "main" | "provider" | "interfaceLanguage" | "responseLanguage" | "contextSize" | "voiceMode" | "imageOutput";

function tierLabel(tier: EffectiveUserAiSettings["tier"]): string {
    const labels: Record<EffectiveUserAiSettings["tier"], string> = {
        creator: Environment.userSettingsCreatorTierText,
        admin: Environment.userSettingsAdminTierText,
        user: Environment.userSettingsUserTierText,
    };

    return labels[tier];
}

function callbackData(settings: EffectiveUserAiSettings, screen: UserSettingsScreen, value?: string): string {
    return [USER_SETTINGS_CALLBACK_PREFIX, String(settings.userId), screen, value].filter(Boolean).join(" ");
}

function selectedText(selected: boolean, text: string): string {
    return selected ? Environment.getUserSettingsSelectedText(text) : text;
}

function currentProviderText(settings: EffectiveUserAiSettings): string {
    if (settings.providerChoice !== DEFAULT_AI_PROVIDER_CHOICE) {
        return getProviderChoiceLabel(settings.providerChoice);
    }

    return `${getProviderChoiceLabel(DEFAULT_AI_PROVIDER_CHOICE)} (${getProviderChoiceLabel(Environment.DEFAULT_AI_PROVIDER)})`;
}

export function formatUserSettingsText(settings: EffectiveUserAiSettings, screen: UserSettingsScreen = "main"): string {
    const title = Environment.getUserSettingsTitle(screen);

    return [
        title,
        "",
        Environment.getUserSettingsFieldText(Environment.userSettingsTierLabel, tierLabel(settings.tier)),
        Environment.getUserSettingsFieldText(Environment.userSettingsAiProviderLabel, currentProviderText(settings)),
        Environment.getUserSettingsFieldText(Environment.userSettingsInterfaceLanguageLabel, getInterfaceLanguageLabel(settings.interfaceLanguage)),
        Environment.getUserSettingsFieldText(Environment.userSettingsResponseLanguageLabel, getResponseLanguageLabel(settings.responseLanguage)),
        Environment.getUserSettingsFieldText(Environment.userSettingsContextSizeLabel, getContextSizeLabel(settings.contextSizeChoice)),
        Environment.getUserSettingsFieldText(Environment.userSettingsVoiceModeLabel, getVoiceModeLabel(settings.voiceMode)),
        Environment.getUserSettingsFieldText(Environment.userSettingsImageOutputLabel, getImageOutputModeLabel(settings.imageOutputMode)),
    ].join("\n");
}

export function buildUserSettingsKeyboard(settings: EffectiveUserAiSettings, screen: UserSettingsScreen = "main"): InlineKeyboardMarkup {
    if (screen === "provider") {
        return {
            inline_keyboard: [
                ...settings.availableProviderChoices.map(choice => {
                    const text = choice === DEFAULT_AI_PROVIDER_CHOICE
                        ? currentProviderText({...settings, providerChoice: DEFAULT_AI_PROVIDER_CHOICE})
                        : getProviderChoiceLabel(choice);

                    return [{
                        text: selectedText(settings.providerChoice === choice, text),
                        callback_data: callbackData(settings, "provider", choice),
                    }];
                }),
                [{text: Environment.userSettingsBackButtonText, callback_data: callbackData(settings, "main")}],
            ],
        };
    }

    if (screen === "interfaceLanguage") {
        return {
            inline_keyboard: [
                ...getUserLanguageChoices().map(language => [{
                    text: selectedText(settings.interfaceLanguage === language, getInterfaceLanguageLabel(language)),
                    callback_data: callbackData(settings, "interfaceLanguage", language),
                }]),
                [{text: Environment.userSettingsBackButtonText, callback_data: callbackData(settings, "main")}],
            ],
        };
    }

    if (screen === "responseLanguage") {
        return {
            inline_keyboard: [
                ...getUserLanguageChoices().map(language => [{
                    text: selectedText(settings.responseLanguage === language, getResponseLanguageLabel(language)),
                    callback_data: callbackData(settings, "responseLanguage", language),
                }]),
                [{text: Environment.userSettingsBackButtonText, callback_data: callbackData(settings, "main")}],
            ],
        };
    }

    if (screen === "contextSize") {
        return {
            inline_keyboard: [
                ...settings.availableContextSizeChoices.map(choice => [{
                    text: selectedText(settings.contextSizeChoice === choice, getContextSizeLabel(choice)),
                    callback_data: callbackData(settings, "contextSize", String(choice)),
                }]),
                [{text: Environment.userSettingsBackButtonText, callback_data: callbackData(settings, "main")}],
            ],
        };
    }

    if (screen === "voiceMode") {
        return {
            inline_keyboard: [
                ...settings.availableVoiceModes.map(mode => [{
                    text: selectedText(settings.voiceMode === mode, getVoiceModeLabel(mode)),
                    callback_data: callbackData(settings, "voiceMode", mode),
                }]),
                [{text: Environment.userSettingsBackButtonText, callback_data: callbackData(settings, "main")}],
            ],
        };
    }

    if (screen === "imageOutput") {
        return {
            inline_keyboard: [
                ...settings.availableImageOutputModes.map(mode => [{
                    text: selectedText(settings.imageOutputMode === mode, getImageOutputModeLabel(mode)),
                    callback_data: callbackData(settings, "imageOutput", mode),
                }]),
                [{text: Environment.userSettingsBackButtonText, callback_data: callbackData(settings, "main")}],
            ],
        };
    }

    return {
        inline_keyboard: [
            [{
                text: Environment.getUserSettingsFieldText(Environment.userSettingsAiProviderButtonPrefix, currentProviderText(settings)),
                callback_data: callbackData(settings, "provider")
            }],
            [{
                text: Environment.getUserSettingsFieldText(Environment.userSettingsInterfaceLanguageButtonPrefix, getInterfaceLanguageLabel(settings.interfaceLanguage)),
                callback_data: callbackData(settings, "interfaceLanguage")
            }],
            [{
                text: Environment.getUserSettingsFieldText(Environment.userSettingsResponseLanguageButtonPrefix, getResponseLanguageLabel(settings.responseLanguage)),
                callback_data: callbackData(settings, "responseLanguage")
            }],
            [{
                text: Environment.getUserSettingsFieldText(Environment.userSettingsContextSizeButtonPrefix, getContextSizeLabel(settings.contextSizeChoice)),
                callback_data: callbackData(settings, "contextSize")
            }],
            [{
                text: Environment.getUserSettingsFieldText(Environment.userSettingsVoiceModeButtonPrefix, getVoiceModeLabel(settings.voiceMode)),
                callback_data: callbackData(settings, "voiceMode")
            }],
            [{
                text: Environment.getUserSettingsFieldText(Environment.userSettingsImageOutputButtonPrefix, getImageOutputModeLabel(settings.imageOutputMode)),
                callback_data: callbackData(settings, "imageOutput")
            }],
        ],
    };
}

export function parseUserSettingsCallbackData(data: string | undefined): {
    userId: number;
    screen: UserSettingsScreen;
    providerChoice?: UserAiProviderChoice;
    interfaceLanguage?: UserInterfaceLanguage;
    responseLanguage?: UserAiResponseLanguage;
    contextSizeChoice?: UserAiContextSizeChoice | string;
    voiceMode?: UserAiVoiceMode;
    imageOutputMode?: UserAiImageOutputMode;
} | null {
    if (!data?.startsWith(USER_SETTINGS_CALLBACK_PREFIX)) return null;

    const [, userIdValue, screenValue, value] = data.split(" ");
    const userId = Number(userIdValue);
    const screen = (screenValue === "language" ? "responseLanguage" : screenValue || "main") as UserSettingsScreen;

    if (!Number.isSafeInteger(userId)) {
        return null;
    }

    if (
        screen !== "main"
        && screen !== "provider"
        && screen !== "interfaceLanguage"
        && screen !== "responseLanguage"
        && screen !== "contextSize"
        && screen !== "voiceMode"
        && screen !== "imageOutput"
    ) {
        return null;
    }

    return {
        userId,
        screen,
        providerChoice: screen === "provider" ? value as UserAiProviderChoice | undefined : undefined,
        interfaceLanguage: screen === "interfaceLanguage" ? value as UserInterfaceLanguage | undefined : undefined,
        responseLanguage: screen === "responseLanguage" ? value as UserAiResponseLanguage | undefined : undefined,
        contextSizeChoice: screen === "contextSize" ? value as UserAiContextSizeChoice | string | undefined : undefined,
        voiceMode: screen === "voiceMode" ? value as UserAiVoiceMode | undefined : undefined,
        imageOutputMode: screen === "imageOutput" ? value as UserAiImageOutputMode | undefined : undefined,
    };
}
