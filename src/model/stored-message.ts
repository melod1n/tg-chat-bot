import {StoredAttachment} from "./stored-attachment";
import type {PipelineAuditEvent} from "../ai/user-request-pipeline";

export type StoredMessage = {
    chatId: number;
    id: number;
    replyToMessageId?: number;
    fromId: number;
    text?: string | null;
    quoteText?: string | null;
    date: number;
    deletedByBotAt?: number | null;
    attachments?: StoredAttachment[] | null;
    pipelineAudit?: PipelineAuditEvent[] | null;
};
