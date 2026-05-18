import {AsyncLocalStorage} from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import {appLogger} from "../logging/logger.js";

const logger = appLogger.child("localization");

export const DEFAULT_LOCALE = "en";
export const DEFAULT_LANGUAGE_CHOICE = "default";

export type LanguageChoice = string;
export type LocalizationParam = string | number | boolean | null | undefined;
export type LocalizationParams = Record<string, LocalizationParam>;
interface LocalizationBundle {
    readonly [key: string]: LocalizationValue;
}
type LocalizationValue = string | number | boolean | null | undefined | readonly LocalizationValue[] | LocalizationBundle;

const KNOWN_LANGUAGE_ORDER = ["en", "ru", "ua"];

function normalizeLanguageCode(value: string | undefined | null): string | undefined {
    const normalized = value?.trim().toLowerCase().replace("_", "-");
    if (!normalized) return undefined;

    const code = normalized.split("-")[0];
    return code === "uk" ? "ua" : code;
}

function readMtimeMs(filePath: string): number | undefined {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

function valueByPath(bundle: LocalizationBundle, key: string): LocalizationValue | undefined {
    if (Object.prototype.hasOwnProperty.call(bundle, key)) {
        return bundle[key];
    }

    return key.split(".").reduce<LocalizationValue | undefined>((value, part) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        return (value as LocalizationBundle)[part];
    }, bundle);
}

function interpolate(value: string, params: LocalizationParams): string {
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const param = params[key];
        return param === undefined || param === null ? match : String(param);
    });
}

export class Localization {
    private static localesDir = path.resolve("locales");
    private static bundles = new Map<string, LocalizationBundle>();
    private static fileMtimeMs = new Map<string, number | undefined>();
    private static fileSignature = "";
    private static readonly storage = new AsyncLocalStorage<string>();

    static configure(localesDir: string): void {
        Localization.localesDir = path.resolve(localesDir);
        Localization.reload(true);
    }

    static reloadIfChanged(): void {
        Localization.reload(false);
    }

    static runWithLocale<T>(locale: string, callback: () => T): T {
        const resolved = Localization.normalizeLocale(locale) ?? DEFAULT_LOCALE;
        return Localization.storage.run(resolved, callback);
    }

    static currentLocale(): string {
        return Localization.storage.getStore() ?? DEFAULT_LOCALE;
    }

    static resolveLocale(choice: LanguageChoice | undefined | null, telegramLanguageCode?: string): string {
        Localization.reloadIfChanged();

        const normalizedChoice = Localization.normalizeLocale(choice);
        if (normalizedChoice && normalizedChoice !== DEFAULT_LANGUAGE_CHOICE && Localization.bundles.has(normalizedChoice)) {
            return normalizedChoice;
        }

        const telegramLocale = Localization.normalizeLocale(telegramLanguageCode);
        if (telegramLocale && Localization.bundles.has(telegramLocale)) {
            return telegramLocale;
        }

        return Localization.bundles.has(DEFAULT_LOCALE)
            ? DEFAULT_LOCALE
            : Localization.availableLocaleCodes()[0] ?? DEFAULT_LOCALE;
    }

    static normalizeLocale(value: LanguageChoice | undefined | null): string | undefined {
        return normalizeLanguageCode(value);
    }

    static isKnownLanguageChoice(value: string | undefined | null): boolean {
        if (!value) return false;
        if (value === DEFAULT_LANGUAGE_CHOICE) return true;

        const normalized = Localization.normalizeLocale(value);
        if (!normalized) return false;

        Localization.reloadIfChanged();
        return Localization.bundles.has(normalized);
    }

    static availableLocaleCodes(): string[] {
        Localization.reloadIfChanged();

        return [...Localization.bundles.keys()].sort((a, b) => {
            const aIndex = KNOWN_LANGUAGE_ORDER.indexOf(a);
            const bIndex = KNOWN_LANGUAGE_ORDER.indexOf(b);

            if (aIndex !== -1 || bIndex !== -1) {
                return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex)
                    - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
            }

            return a.localeCompare(b);
        });
    }

    static languageChoices(): string[] {
        return [DEFAULT_LANGUAGE_CHOICE, ...Localization.availableLocaleCodes()];
    }

    static languageLabel(choice: LanguageChoice): string {
        if (choice === DEFAULT_LANGUAGE_CHOICE) {
            return Localization.text("language.default", {}, "Default");
        }

        const locale = Localization.normalizeLocale(choice) ?? choice;
        return Localization.text(`language.${locale}`, {}, locale.toUpperCase());
    }

    static languageInstructionName(choice: LanguageChoice): string {
        if (choice === DEFAULT_LANGUAGE_CHOICE) return "";

        const locale = Localization.normalizeLocale(choice) ?? choice;
        const bundle = Localization.bundles.get(locale);
        const value = bundle ? valueByPath(bundle, "language.instructionName") : undefined;
        return typeof value === "string" && value.trim().length > 0 ? value : locale;
    }

    static text(
        key: string,
        params: LocalizationParams = {},
        fallback = key,
        locale = Localization.currentLocale(),
    ): string {
        Localization.reloadIfChanged();

        const value = Localization.lookup(locale, key);
        return interpolate(typeof value === "string" ? value : fallback, params);
    }

    static textArray(
        key: string,
        params: LocalizationParams = {},
        fallback: string[] = [],
        locale = Localization.currentLocale(),
    ): string[] {
        Localization.reloadIfChanged();

        const value = Localization.lookup(locale, key);
        const values = Array.isArray(value) && value.every(item => typeof item === "string")
            ? value
            : fallback;

        return values.map(item => interpolate(item, params));
    }

    private static lookup(locale: string, key: string): LocalizationValue | undefined {
        const normalized = Localization.normalizeLocale(locale) ?? DEFAULT_LOCALE;
        const bundleValue = Localization.lookupInBundle(normalized, key);
        if (bundleValue !== undefined) return bundleValue;

        if (normalized !== DEFAULT_LOCALE) {
            const fallbackValue = Localization.lookupInBundle(DEFAULT_LOCALE, key);
            if (fallbackValue !== undefined) return fallbackValue;
        }

        return undefined;
    }

    private static lookupInBundle(locale: string, key: string): LocalizationValue | undefined {
        const bundle = Localization.bundles.get(locale);
        return bundle ? valueByPath(bundle, key) : undefined;
    }

    private static listLocaleFiles(): Map<string, string> {
        const files = new Map<string, string>();

        if (!fs.existsSync(Localization.localesDir)) {
            return files;
        }

        for (const entry of fs.readdirSync(Localization.localesDir, {withFileTypes: true})) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

            const locale = Localization.normalizeLocale(path.basename(entry.name, ".json"));
            if (locale) {
                files.set(locale, path.join(Localization.localesDir, entry.name));
            }
        }

        return files;
    }

    private static reload(force: boolean): void {
        try {
            const files = Localization.listLocaleFiles();
            const signature = [...files.entries()]
                .map(([locale, filePath]) => `${locale}:${filePath}`)
                .sort()
                .join("|");

            const mtimes = new Map<string, number | undefined>();
            let changed = force || signature !== Localization.fileSignature;

            for (const [locale, filePath] of files) {
                const mtimeMs = readMtimeMs(filePath);
                mtimes.set(locale, mtimeMs);

                if (mtimeMs !== Localization.fileMtimeMs.get(locale)) {
                    changed = true;
                }
            }

            if (!changed) return;

            const bundles = new Map<string, LocalizationBundle>();
            for (const [locale, filePath] of files) {
                try {
                    bundles.set(locale, JSON.parse(fs.readFileSync(filePath, "utf8")) as LocalizationBundle);
                } catch (e) {
                    logger.error("file_load.failed", {filePath, locale, error: e instanceof Error ? e : String(e)});
                    const previous = Localization.bundles.get(locale);
                    if (previous) bundles.set(locale, previous);
                }
            }

            Localization.bundles = bundles;
            Localization.fileMtimeMs = mtimes;
            Localization.fileSignature = signature;
            logger.debug("reload.done", {force, locales: [...bundles.keys()]});
        } catch (e) {
            logger.error("reload.failed", {error: e instanceof Error ? e : String(e)});
        }
    }
}
