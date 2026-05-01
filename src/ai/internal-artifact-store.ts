import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {Environment} from "../common/environment";
import {ArtifactStore} from "../common/artifact-store";
import type {StoredAttachment} from "../model/stored-attachment";
import {PIPELINE_ATTACHMENT_LIMIT_BYTES, type PipelineArtifactKind} from "./user-request-pipeline";

export type InternalArtifactAttachmentInput = {
    artifactKind: PipelineArtifactKind;
    fileNamePrefix: string;
    chatId: number;
    messageId: number;
    requestId?: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
};

const INTERNAL_ARTIFACT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function sha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
}

function safeFileNamePart(value: string): string {
    return value.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 80) || "artifact";
}

export async function persistInternalJsonArtifactAttachment(input: InternalArtifactAttachmentInput): Promise<StoredAttachment> {
    const createdAt = new Date().toISOString();
    const buffer = Buffer.from(JSON.stringify({
        artifactKind: input.artifactKind,
        createdAt,
        ...input.payload,
    }, null, 2), "utf8");

    if (buffer.length > PIPELINE_ATTACHMENT_LIMIT_BYTES) {
        throw new Error(`Internal ${input.artifactKind} artifact is larger than ${PIPELINE_ATTACHMENT_LIMIT_BYTES} bytes.`);
    }

    const dir = path.join(Environment.DATA_PATH, "cache", "internal-artifacts", input.artifactKind);
    fs.mkdirSync(dir, {recursive: true});

    const digest = sha256(buffer);
    const fileName = `${safeFileNamePart(input.fileNamePrefix)}-${input.chatId}-${input.messageId}-${Date.now()}.json`;
    const cachePath = path.join(dir, fileName);
    fs.writeFileSync(cachePath, buffer);

    const attachment: StoredAttachment = {
        kind: "document",
        fileId: cachePath,
        fileUniqueId: digest,
        fileName,
        mimeType: "application/json",
        cachePath,
        sizeBytes: buffer.length,
        sha256: digest,
        scope: "internal_artifact",
        artifactKind: input.artifactKind,
        metadata: input.metadata,
    };

    await ArtifactStore.put({
        id: "",
        requestId: input.requestId ?? `message:${input.chatId}:${input.messageId}:${input.artifactKind}`,
        messageChatId: input.chatId,
        messageId: input.messageId,
        kind: input.artifactKind,
        stage: input.artifactKind,
        attachmentId: cachePath,
        payload: {
            artifactKind: input.artifactKind,
            createdAt,
            ...input.payload,
        },
        createdAt,
        attachment,
    });

    return attachment;
}

export function cleanupInternalArtifactCache(now = Date.now()): void {
    const root = path.join(Environment.DATA_PATH, "cache", "internal-artifacts");
    if (!fs.existsSync(root)) return;

    const cutoff = now - INTERNAL_ARTIFACT_RETENTION_MS;
    for (const artifactKind of fs.readdirSync(root, {withFileTypes: true})) {
        if (!artifactKind.isDirectory()) continue;

        const dir = path.join(root, artifactKind.name);
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (!entry.isFile()) continue;

            const filePath = path.join(dir, entry.name);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
                fs.rmSync(filePath, {force: true});
            }
        }
    }
}
