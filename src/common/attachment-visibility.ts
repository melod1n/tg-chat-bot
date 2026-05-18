import type {StoredAttachment} from "../model/stored-attachment";

export function filterUserVisibleStoredAttachments(attachments: StoredAttachment[]): StoredAttachment[] {
    return attachments.filter(attachment => attachment.scope !== "internal_artifact");
}
