import {DatabaseManager} from "./database-manager";
import {StoredMessage} from "../model/stored-message";
import {Dao} from "../base/dao";
import {appLogger} from "../logging/logger";
import {StoredAttachment} from "../model/stored-attachment";
import {MessageDbRow} from "./db-types";
import type {PipelineAuditEvent} from "../ai/user-request-pipeline";

export class MessageDao extends Dao<StoredMessage, {chatId: number; id: number}, {chatId: number; ids: number[]}, MessageDbRow[]> {

    private readonly logger = appLogger.child("dao:messages");

    override async getAll(): Promise<StoredMessage[]> {
        const then = Date.now();

        const messages = await DatabaseManager.getAllMessages();
        const hydrated = await this.hydrateMissingMessageData(messages);

        const now = Date.now();
        const diff = now - then;
        this.logger.trace("get_all", {dao: "messages", duration: `${diff}ms`, size: hydrated.length});

        return this.mapFrom(hydrated);
    }

    override async getById(params: { chatId: number, id: number }): Promise<StoredMessage | null> {
        const then = Date.now();

        const message = await DatabaseManager.getMessageById(params.chatId, params.id);
        const hydrated = await this.hydrateMissingMessageData(message ? [message] : []);

        const now = Date.now();
        const diff = now - then;
        this.logger.trace("get_by_id", {dao: "messages", chatId: params.chatId, id: params.id, duration: `${diff}ms`, size: hydrated.length});

        if (!hydrated.length) return null;
        return this.mapFrom(hydrated)[0];
    }

    override async getByIds(params: { chatId: number, ids: number[] }): Promise<StoredMessage[]> {
        const then = Date.now();

        const messages = await DatabaseManager.getMessagesByIds(params.chatId, params.ids);
        const hydrated = await this.hydrateMissingMessageData(messages);

        const now = Date.now();
        const diff = now - then;
        this.logger.trace("get_by_ids", {dao: "messages", chatId: params.chatId, ids: params.ids, duration: `${diff}ms`, size: hydrated.length});

        return this.mapFrom(hydrated);
    }

    async insert(values: MessageDbRow[]): Promise<true> {
        if (!values.length) return true;

        const then = Date.now();
        await DatabaseManager.upsertMessages(values);

        const now = Date.now();
        const diff = now - then;
        this.logger.debug("insert", {dao: "messages", duration: `${diff}ms`, size: values.length});
        return true;
    }

    mapStoredTo(messages: StoredMessage[]): MessageDbRow[] {
        return messages.map(msg => {
            return {
                chatId: msg.chatId,
                id: msg.id,
                replyToMessageId: msg.replyToMessageId ?? null,
                fromId: msg.fromId,
                text: msg.text ?? null,
                quoteText: msg.quoteText ?? null,
                date: msg.date,
                deletedByBotAt: msg.deletedByBotAt ?? null,
                attachments: msg.attachments?.length ? JSON.stringify(msg.attachments) : null,
                pipelineAudit: msg.pipelineAudit?.length ? JSON.stringify(msg.pipelineAudit) : null,
            };
        });
    }

    mapFrom(messages: MessageDbRow[]): StoredMessage[] {
        return messages.map(m => {
            return {
                chatId: m.chatId,
                id: m.id,
                replyToMessageId: m.replyToMessageId || undefined,
                fromId: m.fromId,
                text: m.text,
                quoteText: m.quoteText,
                date: m.date,
                deletedByBotAt: m.deletedByBotAt,
                attachments: parseAttachments(m.attachments),
                pipelineAudit: parsePipelineAudit(m.pipelineAudit),
            };
        });
    }

    private async hydrateMissingMessageData(messages: MessageDbRow[]): Promise<MessageDbRow[]> {
        if (!messages.length) return [];

        return await Promise.all(messages.map(async message => {
            if (message.attachments?.trim() && message.pipelineAudit?.trim()) return message;

            const [attachments, audits] = await Promise.all([
                message.attachments?.trim() ? Promise.resolve(null) : DatabaseManager.getAttachmentsByMessage(message.chatId, message.id),
                message.pipelineAudit?.trim() ? Promise.resolve(null) : DatabaseManager.getRequestAuditsByMessage(message.chatId, message.id),
            ]);
            const normalizedAttachments = attachments ?? [];
            const normalizedAudits = audits ?? [];

            return {
                ...message,
                attachments: message.attachments ?? (normalizedAttachments.length ? JSON.stringify(normalizedAttachments.map(row => attachmentFromRow(row))) : null),
                pipelineAudit: message.pipelineAudit ?? (normalizedAudits.length ? JSON.stringify(normalizedAudits.map(row => auditFromRow(row))) : null),
            };
        }));
    }
}

function parsePipelineAudit(value?: string | null): PipelineAuditEvent[] | undefined {
    if (!value?.trim()) return undefined;

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function parseAttachments(value?: string | null): StoredAttachment[] | undefined {
    if (!value?.trim()) return undefined;

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function attachmentFromRow(row: Awaited<ReturnType<typeof DatabaseManager.getAttachmentsByMessage>>[number]): StoredAttachment {
    return {
        kind: row.kind as StoredAttachment["kind"],
        fileId: row.fileId,
        fileUniqueId: row.fileUniqueId ?? undefined,
        fileName: row.fileName,
        mimeType: row.mimeType ?? undefined,
        cachePath: row.cachePath,
        sizeBytes: row.sizeBytes ?? undefined,
        sha256: row.sha256 ?? undefined,
        scope: row.scope as StoredAttachment["scope"] | undefined,
        artifactKind: row.artifactKind as StoredAttachment["artifactKind"] | undefined,
        metadata: parseJsonObject(row.metadata),
    };
}

function auditFromRow(row: Awaited<ReturnType<typeof DatabaseManager.getRequestAuditsByMessage>>[number]): NonNullable<StoredMessage["pipelineAudit"]>[number] {
    return {
        stage: row.stage as NonNullable<StoredMessage["pipelineAudit"]>[number]["stage"],
        status: row.status as NonNullable<StoredMessage["pipelineAudit"]>[number]["status"],
        startedAt: row.startedAt ?? undefined,
        finishedAt: row.finishedAt ?? undefined,
        durationMs: row.durationMs ?? undefined,
        provider: row.provider as NonNullable<StoredMessage["pipelineAudit"]>[number]["provider"],
        model: row.model ?? undefined,
        details: parseJsonObject(row.details),
        error: row.error ?? undefined,
    };
}

function parseJsonObject(value?: string | null): Record<string, unknown> | undefined {
    if (!value?.trim()) return undefined;

    try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}
