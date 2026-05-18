import path from "node:path";
import {Environment} from "./environment";
import {StoredAttachment} from "../model/stored-attachment";
export {filterUserVisibleStoredAttachments} from "./attachment-visibility";

export function photoCachePathForUniqueId(uniqueId: string): string {
    return path.join(Environment.DATA_PATH, "cache", "photo", `${uniqueId}.jpg`);
}

export function createStoredImageAttachment(params: {
    fileId: string;
    fileUniqueId?: string;
    fileName?: string;
    cachePath?: string;
}): StoredAttachment {
    const fileUniqueId = params.fileUniqueId ?? params.fileId;
    return {
        kind: "image",
        fileId: params.fileId,
        fileUniqueId: params.fileUniqueId,
        fileName: params.fileName ?? `${fileUniqueId}.jpg`,
        mimeType: "image/jpeg",
        cachePath: params.cachePath ?? photoCachePathForUniqueId(fileUniqueId),
    };
}

export function storedAttachmentIdentity(attachment: StoredAttachment): string {
    return [
        attachment.kind,
        attachment.fileUniqueId || attachment.fileId,
        attachment.cachePath,
    ].join(":");
}

export function uniqueStoredAttachments(attachments: StoredAttachment[]): StoredAttachment[] {
    const seen = new Set<string>();
    const result: StoredAttachment[] = [];

    for (const attachment of attachments) {
        const key = storedAttachmentIdentity(attachment);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(attachment);
    }

    return result;
}
