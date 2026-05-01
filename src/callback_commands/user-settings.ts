import {CallbackQuery} from "typescript-telegram-bot-api";
import {CallbackCommand} from "../base/callback-command";
import {UserStore} from "../common/user-store";
import {
    ensureValidUserAiSettings,
    normalizeAiContextSizeChoice,
    normalizeAiImageOutputMode,
    normalizeAiProviderChoice,
    normalizeAiResponseLanguage,
    normalizeAiVoiceMode,
    normalizeInterfaceLanguage,
    resolveInterfaceLocaleForUser,
    setUserAiContextSizeChoice,
    setUserAiImageOutputMode,
    setUserAiProviderChoice,
    setUserAiResponseLanguage,
    setUserAiVoiceMode,
    setUserInterfaceLanguage,
} from "../common/user-ai-settings";
import {
    buildUserSettingsKeyboard,
    formatUserSettingsText,
    parseUserSettingsCallbackData,
    USER_SETTINGS_CALLBACK_PREFIX,
    UserSettingsScreen,
} from "../common/user-settings-view";
import {editMessageText, ignoreIfNotChanged, logError} from "../util/utils";
import {Environment} from "../common/environment";
import {Localization} from "../common/localization";

export class UserSettingsCallback extends CallbackCommand {
    data = USER_SETTINGS_CALLBACK_PREFIX;
    text = Environment.userSettingsCallbackText;

    async execute(query: CallbackQuery): Promise<void> {
        if (!query.message || !query.data) return;

        const message = query.message;
        const parsed = parseUserSettingsCallbackData(query.data);
        if (!parsed || parsed.userId !== query.from.id) return;

        await UserStore.put(query.from);

        let screen: UserSettingsScreen = parsed.screen;
        let settings = await ensureValidUserAiSettings(query.from.id);

        if (parsed.screen === "provider" && parsed.providerChoice) {
            const choice = normalizeAiProviderChoice(parsed.providerChoice);
            if (choice) {
                const result = await setUserAiProviderChoice(query.from.id, choice);
                settings = result.settings;
            }
            screen = "provider";
        }

        if (parsed.screen === "interfaceLanguage" && parsed.interfaceLanguage) {
            const language = normalizeInterfaceLanguage(parsed.interfaceLanguage);
            if (language) {
                const result = await setUserInterfaceLanguage(query.from.id, language);
                settings = result.settings;
            }
            screen = "interfaceLanguage";
        }

        if (parsed.screen === "responseLanguage" && parsed.responseLanguage) {
            const language = normalizeAiResponseLanguage(parsed.responseLanguage);
            if (language) {
                const result = await setUserAiResponseLanguage(query.from.id, language);
                settings = result.settings;
            }
            screen = "responseLanguage";
        }

        if (parsed.screen === "contextSize" && parsed.contextSizeChoice) {
            const choice = normalizeAiContextSizeChoice(parsed.contextSizeChoice);
            if (choice || choice === -1) {
                const result = await setUserAiContextSizeChoice(query.from.id, choice);
                settings = result.settings;
            }
            screen = "contextSize";
        }

        if (parsed.screen === "voiceMode" && parsed.voiceMode) {
            const mode = normalizeAiVoiceMode(parsed.voiceMode);
            if (mode) {
                const result = await setUserAiVoiceMode(query.from.id, mode);
                settings = result.settings;
            }
            screen = "voiceMode";
        }

        if (parsed.screen === "imageOutput" && parsed.imageOutputMode) {
            const mode = normalizeAiImageOutputMode(parsed.imageOutputMode);
            if (mode) {
                const result = await setUserAiImageOutputMode(query.from.id, mode);
                settings = result.settings;
            }
            screen = "imageOutput";
        }

        const locale = await resolveInterfaceLocaleForUser(query.from.id, query.from.language_code);

        await Localization.runWithLocale(locale, () => editMessageText({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: formatUserSettingsText(settings, screen),
            reply_markup: buildUserSettingsKeyboard(settings, screen),
        })).catch(ignoreIfNotChanged).catch(logError);
    }
}
