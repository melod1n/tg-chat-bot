import {createHash} from "node:crypto";
import {DatabaseManager} from "../db/database-manager";
import type {RequestAuditDbRow} from "../db/db-types";
import type {PipelineAuditEvent} from "../ai/user-request-pipeline";

function hashId(parts: Array<string | number | null | undefined>): string {
    return createHash("sha256").update(parts.map(part => part === null || part === undefined ? "" : String(part)).join("\u0000")).digest("hex");
}

function toAuditRow(params: {
    requestId: string;
    messageChatId: number;
    messageId: number;
    event: PipelineAuditEvent;
    ordinal: number;
}): RequestAuditDbRow {
    const startedAt = params.event.startedAt ?? null;
    const finishedAt = params.event.finishedAt ?? null;
    const durationMs = params.event.durationMs ?? null;
    const details = params.event.details ? JSON.stringify(params.event.details) : null;

    return {
        id: hashId([params.requestId, params.messageChatId, params.messageId, params.event.stage, params.event.status, startedAt, finishedAt, params.ordinal]),
        requestId: params.requestId,
        messageChatId: params.messageChatId,
        messageId: params.messageId,
        stage: params.event.stage,
        status: params.event.status,
        startedAt,
        finishedAt,
        durationMs,
        provider: params.event.provider ?? null,
        model: params.event.model ?? null,
        details,
        error: params.event.error ?? null,
    };
}

export class RequestAuditStore {
    static async putMessageAudit(params: {
        requestId: string;
        messageChatId: number;
        messageId: number;
        events: PipelineAuditEvent[];
    }): Promise<void> {
        const rows = params.events.map((event, ordinal) => toAuditRow({
            requestId: params.requestId,
            messageChatId: params.messageChatId,
            messageId: params.messageId,
            event,
            ordinal,
        }));

        await DatabaseManager.upsertRequestAudits(rows);
    }
}
