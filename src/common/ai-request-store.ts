import {DatabaseManager} from "../db/database-manager";
import type {AiRequestDbRow} from "../db/db-types";
import type {StoredAiRequest} from "../model/stored-ai-request";

function toDbRow(request: StoredAiRequest): AiRequestDbRow {
    return {
        requestId: request.requestId,
        chatId: request.chatId,
        messageId: request.messageId,
        responseMessageId: request.responseMessageId ?? null,
        fromId: request.fromId,
        provider: request.provider,
        model: request.model,
        status: request.status,
        startedAt: request.startedAt,
        finishedAt: request.finishedAt ?? null,
        error: request.error ?? null,
    };
}

export class AiRequestStore {
    static async put(request: StoredAiRequest): Promise<void> {
        await DatabaseManager.upsertAiRequests([toDbRow(request)]);
    }
}
