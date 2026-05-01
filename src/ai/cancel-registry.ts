import {randomUUID} from "node:crypto";

export type AiCancelRequest = {
    id: string;
    chatId: number;
    messageId?: number;
    fromId: number;
    provider: string;
    controller: AbortController;
    onCancel?: () => Promise<void> | void;
};

const requests = new Map<string, AiCancelRequest>();

export function createAiCancelRequest(params: Omit<AiCancelRequest, "id" | "controller"> & { controller?: AbortController }): AiCancelRequest {
    const request: AiCancelRequest = {
        id: randomUUID(),
        controller: params.controller ?? new AbortController(),
        chatId: params.chatId,
        messageId: params.messageId,
        fromId: params.fromId,
        provider: params.provider,
        onCancel: params.onCancel,
    };
    requests.set(request.id, request);
    return request;
}

export function setAiCancelMessageId(id: string, messageId: number): void {
    const request = requests.get(id);
    if (request) request.messageId = messageId;
}

export function getAiCancelRequest(id: string): AiCancelRequest | undefined {
    return requests.get(id);
}

export async function abortAiRequest(id: string): Promise<boolean> {
    const request = requests.get(id);
    if (!request) return false;

    request.controller.abort();

    try {
        await request.onCancel?.();
    } finally {
        requests.delete(id);
    }

    return true;
}

export function finishAiRequest(id: string): void {
    requests.delete(id);
}
