import type {Message} from "typescript-telegram-bot-api";
import {Localization} from "../../common/localization.js";
import {replyToMessage, logError} from "../../util/utils.js";
import type {PipelineFallbackDecision} from "./fallback-executor.js";
import {PipelineFallbackNotificationRegistry} from "./fallback-notifier-registry.js";
import {resolvePipelineFallbackText} from "./fallback-notifier-text.js";

export class PipelineFallbackNotifier {
    private readonly registry = new PipelineFallbackNotificationRegistry();

    constructor(
        private readonly sourceMessage: Message,
        private readonly responseLanguage?: string,
        private readonly sendFallbackMessage: (text: string) => Promise<void> = async text => {
            await replyToMessage({
                message: this.sourceMessage,
                text,
            });
        },
    ) {}

    async notify(requestId: string, decision: PipelineFallbackDecision): Promise<{notified: boolean; text?: string}> {
        if (!this.registry.claim(requestId, decision)) {
            return {notified: false};
        }

        const locale = this.responseLanguage === "default"
            ? Localization.currentLocale()
            : Localization.normalizeLocale(this.responseLanguage) ?? Localization.currentLocale();
        const text = resolvePipelineFallbackText(decision.stage, decision.action, locale);
        if (!text) {
            return {notified: false};
        }

        try {
            await this.sendFallbackMessage(text);
            return {notified: true, text};
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
            return {notified: false, text};
        }
    }
}
