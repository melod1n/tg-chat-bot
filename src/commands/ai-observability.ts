import {Message} from "typescript-telegram-bot-api";
import {DatabaseManager} from "../db/database-manager.js";
import type {AttachmentDbRow} from "../db/db-types.js";
import {replyToMessage} from "../util/utils.js";
import {snapshotAiObservability} from "../common/ai-observability.js";

export type AuditTarget = {
    chatId: number;
    messageId: number;
};

export function resolveAuditTarget(msg: Message, argsText?: string | null): AuditTarget | null {
    if (msg.reply_to_message) {
        return {
            chatId: msg.chat.id,
            messageId: msg.reply_to_message.message_id,
        };
    }

    const args = argsText?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (!args.length) return null;

    if (args.length === 1) {
        const messageId = Number(args[0]);
        if (!Number.isFinite(messageId)) return null;
        return {
            chatId: msg.chat.id,
            messageId,
        };
    }

    const chatId = Number(args[0]);
    const messageId = Number(args[1]);
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) return null;

    return {chatId, messageId};
}

function formatSize(bytes: number | null | undefined): string {
    if (!Number.isFinite(bytes ?? NaN)) return "n/a";
    const value = Number(bytes);
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
}

function clip(value: string | null | undefined, max = 120): string {
    const text = (value ?? "").trim();
    if (!text) return "n/a";
    return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function formatAttachmentLine(index: number, attachment: AttachmentDbRow): string {
    return [
        `${index + 1}.`,
        attachment.direction,
        attachment.kind,
        attachment.fileName,
        `size=${formatSize(attachment.sizeBytes)}`,
        attachment.artifactKind ? `artifact=${attachment.artifactKind}` : null,
    ].filter(Boolean).join(" ");
}

export async function buildAiAuditReport(target: AuditTarget): Promise<string> {
    const [request, audits, artifacts, attachments] = await Promise.all([
        DatabaseManager.getAiRequestByMessage(target.chatId, target.messageId),
        DatabaseManager.getRequestAuditsByMessage(target.chatId, target.messageId),
        DatabaseManager.getArtifactsByMessage(target.chatId, target.messageId),
        DatabaseManager.getAttachmentsByMessage(target.chatId, target.messageId),
    ]);

    const lines: string[] = [
        "AI observability audit",
        `chatId: ${target.chatId}`,
        `messageId: ${target.messageId}`,
        "",
        "AI request:",
    ];

    if (request) {
        lines.push(
            `  requestId: ${request.requestId}`,
            `  provider: ${request.provider}`,
            `  model: ${request.model}`,
            `  status: ${request.status}`,
            `  startedAt: ${request.startedAt}`,
            `  finishedAt: ${request.finishedAt ?? "n/a"}`,
            `  error: ${clip(request.error, 240)}`,
        );
    } else {
        lines.push("  not found");
    }

    lines.push("", `Pipeline audits: ${audits.length}`);
    audits.slice(0, 12).forEach((audit, index) => {
        lines.push(
            `  ${index + 1}. ${audit.stage} ${audit.status}` +
            `${audit.durationMs !== null ? ` ${audit.durationMs}ms` : ""}` +
            `${audit.provider ? ` provider=${audit.provider}` : ""}` +
            `${audit.model ? ` model=${audit.model}` : ""}` +
            `${audit.error ? ` error=${clip(audit.error, 120)}` : ""}`,
        );
    });
    if (audits.length > 12) {
        lines.push(`  … and ${audits.length - 12} more`);
    }

    lines.push("", `Artifacts: ${artifacts.length}`);
    artifacts.slice(0, 12).forEach((artifact, index) => {
        lines.push(
            `  ${index + 1}. ${artifact.kind} stage=${artifact.stage}` +
            `${artifact.attachmentId ? ` attachmentId=${artifact.attachmentId}` : ""}` +
            `${artifact.createdAt ? ` createdAt=${artifact.createdAt}` : ""}`,
        );
    });
    if (artifacts.length > 12) {
        lines.push(`  … and ${artifacts.length - 12} more`);
    }

    lines.push("", `Attachments: ${attachments.length}`);
    attachments.slice(0, 12).forEach((attachment, index) => {
        lines.push(`  ${formatAttachmentLine(index, attachment)}`);
    });
    if (attachments.length > 12) {
        lines.push(`  … and ${attachments.length - 12} more`);
    }

    return lines.join("\n");
}

export async function buildAiMetricsReport(): Promise<string> {
    const snapshot = snapshotAiObservability();
    const [aiRequests, attachments, artifacts, requestAudits] = await Promise.all([
        DatabaseManager.getAllAiRequests(),
        DatabaseManager.getAllAttachments(),
        DatabaseManager.getAllArtifacts(),
        DatabaseManager.getAllRequestAudits(),
    ]);

    return [
        "AI observability metrics",
        `requests: total=${snapshot.requests.total} succeeded=${snapshot.requests.succeeded} failed=${snapshot.requests.failed} aborted=${snapshot.requests.aborted}`,
        `fallbacks: total=${snapshot.fallbacks.total} ignore=${snapshot.fallbacks.ignore} notify_user=${snapshot.fallbacks.notifyUser} continue_without_stage=${snapshot.fallbacks.continueWithoutStage} use_alternate_target=${snapshot.fallbacks.useAlternateTarget} fail_request=${snapshot.fallbacks.failRequest}`,
        `tool calls: ${snapshot.toolCalls}`,
        `RAG runs: ${snapshot.ragRuns}`,
        `TTS runs: total=${snapshot.ttsRuns.total} succeeded=${snapshot.ttsRuns.succeeded} failed=${snapshot.ttsRuns.failed} skipped=${snapshot.ttsRuns.skipped}`,
        `db rows: ai_requests=${aiRequests.length} attachments=${attachments.length} artifacts=${artifacts.length} request_audit=${requestAudits.length}`,
    ].join("\n");
}

export async function replyWithTrimmedText(msg: Message, text: string): Promise<void> {
    const maxLength = 3800;
    const nextText = text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n… (trimmed)`;
    await replyToMessage({message: msg, text: nextText});
}
