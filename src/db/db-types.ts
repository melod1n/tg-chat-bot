export type UserDbRow = {
    id: number;
    isBot: number;
    firstName: string;
    lastName: string | null;
    userName: string | null;
    isPremium: number | null;
    langCode: string | null;
    interfaceLanguage: string | null;
    aiProvider: string | null;
    aiResponseLanguage: string | null;
    aiContextSize: number | null;
    aiVoiceMode: string | null;
    aiImageOutputMode: string | null;
};

export type MessageDbRow = {
    id: number;
    chatId: number;
    replyToMessageId: number | null;
    fromId: number;
    text: string | null;
    quoteText: string | null;
    date: number;
    deletedByBotAt: number | null;
    attachments: string | null;
    pipelineAudit: string | null;
};

export type AttachmentDbRow = {
    id: string;
    messageChatId: number;
    messageId: number;
    direction: string;
    scope: string;
    kind: string;
    artifactKind: string | null;
    fileId: string;
    fileUniqueId: string | null;
    fileName: string;
    mimeType: string | null;
    cachePath: string;
    sizeBytes: number | null;
    sha256: string | null;
    metadata: string | null;
    createdAt: string;
};

export type ArtifactDbRow = {
    id: string;
    requestId: string;
    messageChatId: number;
    messageId: number;
    kind: string;
    stage: string;
    attachmentId: string | null;
    payload: string;
    createdAt: string;
};

export type RequestAuditDbRow = {
    id: string;
    requestId: string;
    messageChatId: number;
    messageId: number;
    stage: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    provider: string | null;
    model: string | null;
    details: string | null;
    error: string | null;
};

export type AiRequestDbRow = {
    requestId: string;
    chatId: number;
    messageId: number;
    responseMessageId: number | null;
    fromId: number;
    provider: string;
    model: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
};
