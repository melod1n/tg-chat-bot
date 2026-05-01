import {DatabaseManager} from "../db/database-manager";
import type {AttachmentDbRow} from "../db/db-types";
import type {StoredAttachment} from "../model/stored-attachment";

function toAttachmentRow(input: {
    messageChatId: number;
    messageId: number;
    attachment: StoredAttachment;
    direction: string;
    createdAt: string;
    ordinal: number;
}): AttachmentDbRow {
    const attachment = input.attachment;
    const idSource = [
        input.messageChatId,
        input.messageId,
        input.direction,
        attachment.scope ?? "user_input",
        attachment.kind,
        attachment.fileUniqueId ?? attachment.fileId,
        attachment.fileName,
        attachment.cachePath,
        attachment.artifactKind ?? "",
        input.ordinal,
    ].join(":");

    return {
        id: idSource,
        messageChatId: input.messageChatId,
        messageId: input.messageId,
        direction: input.direction,
        scope: attachment.scope ?? "user_input",
        kind: attachment.kind,
        artifactKind: attachment.artifactKind ?? null,
        fileId: attachment.fileId,
        fileUniqueId: attachment.fileUniqueId ?? null,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType ?? null,
        cachePath: attachment.cachePath,
        sizeBytes: attachment.sizeBytes ?? null,
        sha256: attachment.sha256 ?? null,
        metadata: attachment.metadata ? JSON.stringify(attachment.metadata) : null,
        createdAt: input.createdAt,
    };
}

export class AttachmentStore {
    static async putMessageAttachments(params: {
        messageChatId: number;
        messageId: number;
        attachments: StoredAttachment[];
        direction?: string;
        createdAt?: string;
    }): Promise<void> {
        const rows = params.attachments.map((attachment, ordinal) => toAttachmentRow({
            messageChatId: params.messageChatId,
            messageId: params.messageId,
            attachment,
            direction: params.direction ?? (attachment.scope === "bot_output" ? "output" : "input"),
            createdAt: params.createdAt ?? new Date().toISOString(),
            ordinal,
        }));

        await DatabaseManager.upsertAttachments(rows);
    }
}
