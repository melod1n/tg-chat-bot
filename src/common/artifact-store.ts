import {createHash} from "node:crypto";
import {DatabaseManager} from "../db/database-manager";
import type {ArtifactDbRow} from "../db/db-types";
import type {StoredAttachment} from "../model/stored-attachment";
import type {PipelineArtifactKind} from "../ai/user-request-pipeline";

export type StoredArtifactRecord = {
    id: string;
    requestId: string;
    messageChatId: number;
    messageId: number;
    kind: string;
    stage: string;
    attachmentId: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
    attachment?: StoredAttachment;
};

function hashId(parts: Array<string | number | null | undefined>): string {
    return createHash("sha256").update(parts.map(part => part === null || part === undefined ? "" : String(part)).join("\u0000")).digest("hex");
}

function parsePayload(value: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function isPipelineArtifactKind(value: unknown): value is PipelineArtifactKind {
    return value === "rag"
        || value === "transcript"
        || value === "tool_result"
        || value === "generated_file"
        || value === "tts_audio"
        || value === "final_text"
        || value === "error";
}

function storedAttachmentFromPayload(payload: Record<string, unknown>): StoredAttachment | undefined {
    const kind = payload.kind;
    const fileId = payload.fileId;
    const fileName = payload.fileName;
    const cachePath = payload.cachePath;

    if (typeof kind !== "string" || typeof fileId !== "string" || typeof fileName !== "string" || typeof cachePath !== "string") {
        return undefined;
    }

    return {
        kind: "document",
        fileId,
        fileUniqueId: typeof payload.fileUniqueId === "string" ? payload.fileUniqueId : undefined,
        fileName,
        mimeType: typeof payload.mimeType === "string" ? payload.mimeType : undefined,
        cachePath,
        sizeBytes: typeof payload.sizeBytes === "number" ? payload.sizeBytes : undefined,
        sha256: typeof payload.sha256 === "string" ? payload.sha256 : undefined,
        scope: typeof payload.scope === "string" ? payload.scope as StoredAttachment["scope"] : undefined,
        artifactKind: isPipelineArtifactKind(kind) ? kind : undefined,
        metadata: typeof payload.metadata === "object" && payload.metadata !== null ? payload.metadata as Record<string, unknown> : undefined,
    };
}

function toStoredArtifact(row: ArtifactDbRow): StoredArtifactRecord {
    const payload = parsePayload(row.payload);
    return {
        id: row.id,
        requestId: row.requestId,
        messageChatId: row.messageChatId,
        messageId: row.messageId,
        kind: row.kind,
        stage: row.stage,
        attachmentId: row.attachmentId,
        payload,
        createdAt: row.createdAt,
        attachment: storedAttachmentFromPayload(payload),
    };
}

function toArtifactDbRow(record: StoredArtifactRecord): ArtifactDbRow {
    return {
        id: record.id || hashId([record.requestId, record.messageChatId, record.messageId, record.kind, record.attachmentId ?? "", record.createdAt]),
        requestId: record.requestId,
        messageChatId: record.messageChatId,
        messageId: record.messageId,
        kind: record.kind,
        stage: record.stage,
        attachmentId: record.attachmentId,
        payload: JSON.stringify(record.payload),
        createdAt: record.createdAt,
    };
}

export class ArtifactStore {
    static async put(record: StoredArtifactRecord | StoredArtifactRecord[]): Promise<void> {
        const rows = Array.isArray(record) ? record.map(toArtifactDbRow) : [toArtifactDbRow(record)];
        await DatabaseManager.upsertArtifacts(rows);
    }

    static async putMessageArtifacts(params: {
        requestId: string;
        messageChatId: number;
        messageId: number;
        attachments: StoredAttachment[];
        stage?: string;
        createdAt?: string;
    }): Promise<void> {
        const createdAt = params.createdAt ?? new Date().toISOString();
        const rows = params.attachments
            .filter(attachment => Boolean(attachment.artifactKind))
            .map((attachment, index) => ({
                id: hashId([
                    params.requestId,
                    params.messageChatId,
                    params.messageId,
                    attachment.artifactKind ?? "unknown",
                    attachment.fileUniqueId ?? attachment.fileId,
                    createdAt,
                    index,
                ]),
                requestId: params.requestId,
                messageChatId: params.messageChatId,
                messageId: params.messageId,
                kind: attachment.artifactKind ?? "unknown",
                stage: params.stage ?? attachment.artifactKind ?? "unknown",
                attachmentId: attachment.fileUniqueId ?? attachment.fileId,
                payload: {
                    kind: attachment.artifactKind ?? "unknown",
                    fileId: attachment.fileId,
                    fileUniqueId: attachment.fileUniqueId ?? null,
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType ?? null,
                    cachePath: attachment.cachePath,
                    sizeBytes: attachment.sizeBytes ?? null,
                    sha256: attachment.sha256 ?? null,
                    scope: attachment.scope ?? null,
                    metadata: attachment.metadata ?? null,
                    createdAt,
                },
                createdAt,
            }));

        await ArtifactStore.put(rows);
    }

    static async getByRequestId(requestId: string): Promise<StoredArtifactRecord[]> {
        const rows = await DatabaseManager.getArtifactsByRequestId(requestId);
        return rows.map(toStoredArtifact);
    }

    static async getByMessage(chatId: number, messageId: number): Promise<StoredArtifactRecord[]> {
        const rows = await DatabaseManager.getArtifactsByMessage(chatId, messageId);
        return rows.map(toStoredArtifact);
    }

    static async getLatestRagForReplyChain(chatId: number, messageId: number): Promise<StoredArtifactRecord | null> {
        let current = await DatabaseManager.getMessageById(chatId, messageId);

        while (current) {
            const artifacts = await ArtifactStore.getByMessage(current.chatId, current.id);
            const rag = artifacts.filter(artifact => artifact.kind === "rag").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
            if (rag) return rag;
            if (!current.replyToMessageId) break;
            current = await DatabaseManager.getMessageById(chatId, current.replyToMessageId);
        }

        return null;
    }

    static async getTranscriptForMessage(chatId: number, messageId: number): Promise<StoredArtifactRecord | null> {
        const artifacts = await ArtifactStore.getByMessage(chatId, messageId);
        return artifacts.find(artifact => artifact.kind === "transcript") ?? null;
    }
}
