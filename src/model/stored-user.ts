export type StoredUser = {
    id: number;
    isBot: boolean;
    firstName: string;
    lastName?: string;
    userName?: string;
    isPremium?: boolean;
    langCode?: string;
    interfaceLanguage?: string;
    aiProvider?: string;
    aiResponseLanguage?: string;
    aiContextSize?: number;
    aiVoiceMode?: string;
    aiImageOutputMode?: string;
}
