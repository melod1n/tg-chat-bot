import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command";
import {UserStore} from "../common/user-store";
import {
    ensureValidUserAiSettings,
    normalizeAiContextSizeChoice,
    normalizeAiImageOutputMode,
    normalizeAiVoiceMode,
    setUserAiContextSizeChoice,
    setUserAiImageOutputMode,
    setUserAiVoiceMode,
} from "../common/user-ai-settings";
import {buildUserSettingsKeyboard, formatUserSettingsText} from "../common/user-settings-view";
import {logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";

export class Settings extends Command {
    command = ["settings", "config"];
    argsMode = "optional" as const;

    title = Environment.commandTitles.settings;
    description = Environment.commandDescriptions.settings;

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        if (!msg.from) return;

        await UserStore.put(msg.from);
        const args = match?.[3]?.trim();
        let settings = await ensureValidUserAiSettings(msg.from.id);
        let screen: Parameters<typeof formatUserSettingsText>[1] = "main";

        if (args) {
            const [name, ...rest] = args.split(/\s+/);
            const value = rest.join(" ");

            if (name?.toLowerCase() === "context" || name?.toLowerCase() === "ctx") {
                const choice = normalizeAiContextSizeChoice(value);
                if (choice) {
                    settings = (await setUserAiContextSizeChoice(msg.from.id, choice)).settings;
                    screen = "contextSize";
                }
            }

            if (name?.toLowerCase() === "voice" || name?.toLowerCase() === "audio") {
                const mode = normalizeAiVoiceMode(value);
                if (mode) {
                    settings = (await setUserAiVoiceMode(msg.from.id, mode)).settings;
                    screen = "voiceMode";
                }
            }

            if (name?.toLowerCase() === "image" || name?.toLowerCase() === "images" || name?.toLowerCase() === "output") {
                const mode = normalizeAiImageOutputMode(value || name);
                if (mode) {
                    settings = (await setUserAiImageOutputMode(msg.from.id, mode)).settings;
                    screen = "imageOutput";
                }
            }
        }

        await replyToMessage({
            message: msg,
            text: formatUserSettingsText(settings, screen),
            reply_markup: buildUserSettingsKeyboard(settings, screen),
        }).catch(logError);
    }
}
