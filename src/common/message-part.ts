export type MessageImagePart = {
    data: string;
    mimeType: string;
}

export type MessageAudioPart = {
    data: string;
    mimeType: string;
}

export type MessagePart = {
    bot: boolean;
    name?: string;
    langCode?: string;
    userName?: string;
    content: string;
    deletedByBotAt?: number | null;
    images?: string[];
    imageParts?: MessageImagePart[];
    audios?: string[];
    audioParts?: MessageAudioPart[];
    documents?: string[];
    videos?: string[];
    videoNotes?: string[];
}
