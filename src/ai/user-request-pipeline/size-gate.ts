import {PIPELINE_ATTACHMENT_LIMIT_BYTES, type PersistentAttachment} from "./types.js";

export type AttachmentSizeGateResult =
    | {
        ok: true;
        attachment: PersistentAttachment;
    }
    | {
        ok: false;
        attachment: PersistentAttachment;
        limitBytes: number;
        reason: string;
    };

export function validateAttachmentSize(
    attachment: PersistentAttachment,
    limitBytes: number = PIPELINE_ATTACHMENT_LIMIT_BYTES,
): AttachmentSizeGateResult {
    if (attachment.sizeBytes <= limitBytes) {
        return {ok: true, attachment};
    }

    return {
        ok: false,
        attachment,
        limitBytes,
        reason: `Attachment ${attachment.fileName} is larger than ${limitBytes} bytes.`,
    };
}

export function splitAttachmentsBySize(
    attachments: readonly PersistentAttachment[],
    limitBytes: number = PIPELINE_ATTACHMENT_LIMIT_BYTES,
): {
    accepted: PersistentAttachment[];
    rejected: AttachmentSizeGateResult[];
} {
    const accepted: PersistentAttachment[] = [];
    const rejected: AttachmentSizeGateResult[] = [];

    for (const attachment of attachments) {
        const result = validateAttachmentSize(attachment, limitBytes);
        if (result.ok) {
            accepted.push(result.attachment);
        } else {
            rejected.push(result);
        }
    }

    return {accepted, rejected};
}
