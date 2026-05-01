import type {AiProvider} from "./ai-provider";

export type StoredAiRequestStatus = "running" | "succeeded" | "failed" | "aborted";

export type StoredAiRequest = {
    requestId: string;
    chatId: number;
    messageId: number;
    responseMessageId?: number | null;
    fromId: number;
    provider: AiProvider;
    model: string;
    status: StoredAiRequestStatus;
    startedAt: string;
    finishedAt?: string | null;
    error?: string | null;
};
