import {Message} from "typescript-telegram-bot-api";
import {bot} from "../index";
import {downloadTelegramFile, logError} from "../util/utils";
import fs from "node:fs";
import path from "node:path";
import {Environment} from "../common/environment";
import {StoredAttachment, StoredAttachmentKind} from "../model/stored-attachment";
import {performFFmpeg} from "../util/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import {AsyncSemaphore, KeyedAsyncLock} from "../util/async-lock";
import {appLogger} from "../logging/logger";
import {createHash} from "node:crypto";
import {PIPELINE_ATTACHMENT_LIMIT_BYTES} from "./user-request-pipeline/types";

export type AiDownloadedFile = {
    kind: StoredAttachmentKind;
    fileId: string;
    fileName: string;
    mimeType?: string;
    buffer: Buffer;
    path: string;
    sizeBytes?: number;
    sha256?: string;
};

export type RejectedTelegramAttachment = {
    kind: StoredAttachmentKind;
    fileId: string;
    fileUniqueId?: string;
    fileName: string;
    mimeType?: string;
    sizeBytes: number;
    limitBytes: number;
    reason: "too_large";
};

export type TelegramAttachmentDescriptor = {
    kind: StoredAttachmentKind;
    fileId: string;
    fileUniqueId?: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
};

export type MessageAttachmentCacheResult = {
    attachments: StoredAttachment[];
    rejected: RejectedTelegramAttachment[];
};

const cachePathLocks = new KeyedAsyncLock();
const ffmpegSemaphore = new AsyncSemaphore(2);
const logger = appLogger.child("attachments");

function safeFileName(value: string): string {
    return value.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 180);
}

function extensionFromMimeType(mimeType?: string): string {
    switch ((mimeType || "").toLowerCase()) {
        case "audio/ogg":
        case "audio/opus":
            return ".ogg";
        case "audio/mpeg":
        case "audio/mp3":
            return ".mp3";
        case "audio/mp4":
        case "audio/x-m4a":
            return ".m4a";
        case "audio/wav":
        case "audio/wave":
        case "audio/x-wav":
            return ".wav";
        case "audio/webm":
            return ".webm";
        case "image/jpeg":
            return ".jpg";
        case "image/png":
            return ".png";
        case "image/webp":
            return ".webp";
        case "application/pdf":
            return ".pdf";
        case "text/plain":
            return ".txt";
        case "application/zip":
        case "application/x-zip":
        case "application/x-zip-compressed":
            return ".zip";
        case "application/x-tar":
        case "application/tar":
            return ".tar";
        case "application/gzip":
        case "application/x-gzip":
        case "application/gzip-compressed":
            return ".gz";
        case "video/mp4":
            return ".mp4";
        default:
            return "";
    }
}

function fileNameWithExtension(fileName: string, mimeType?: string, telegramFilePath?: string): string {
    if (path.extname(fileName)) return fileName;

    const telegramExt = telegramFilePath ? path.extname(telegramFilePath) : "";
    const ext = telegramExt || extensionFromMimeType(mimeType);
    return ext ? `${fileName}${ext}` : fileName;
}

function cacheDirFor(kind: StoredAttachmentKind): string {
    const dirName = kind === "image" ? "photo" : kind;
    return path.join(Environment.DATA_PATH, "cache", dirName);
}

function cachePathFor(kind: StoredAttachmentKind, fileUniqueId: string | undefined, fileId: string, fileName: string): string {
    const base = safeFileName(fileUniqueId || fileId);
    const ext = path.extname(fileName);
    return path.join(cacheDirFor(kind), `${base}${ext || ""}`);
}

function fileSha256(location: string): string | undefined {
    if (!fs.existsSync(location)) return undefined;
    return createHash("sha256").update(fs.readFileSync(location)).digest("hex");
}

function rejectIfTooLarge(
    rejected: RejectedTelegramAttachment[],
    kind: StoredAttachmentKind,
    fileId: string,
    fileName: string,
    mimeType?: string,
    sizeBytes?: number,
    fileUniqueId?: string,
): boolean {
    if (!sizeBytes || sizeBytes <= PIPELINE_ATTACHMENT_LIMIT_BYTES) {
        return false;
    }

    rejected.push({
        kind,
        fileId,
        fileUniqueId,
        fileName,
        mimeType,
        sizeBytes,
        limitBytes: PIPELINE_ATTACHMENT_LIMIT_BYTES,
        reason: "too_large",
    });
    logger.warn("message.cache.rejected.too_large", {kind, fileId, fileName, mimeType, sizeBytes});
    return true;
}

export function collectTelegramAttachmentDescriptors(msg: Message): TelegramAttachmentDescriptor[] {
    const attachments: TelegramAttachmentDescriptor[] = [];

    if (msg.photo?.length) {
        const size = msg.photo[msg.photo.length - 1]!;
        attachments.push({
            kind: "image",
            fileId: size.file_id,
            fileUniqueId: size.file_unique_id,
            fileName: `${size.file_unique_id || size.file_id}.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: size.file_size,
        });
    }

    if (msg.document) {
        const doc = msg.document;
        attachments.push({
            kind: doc.mime_type?.startsWith("image/")
                ? "image"
                : doc.mime_type?.startsWith("audio/")
                    ? "audio"
                    : "document",
            fileId: doc.file_id,
            fileUniqueId: doc.file_unique_id,
            fileName: doc.file_name || `${doc.file_unique_id || doc.file_id}`,
            mimeType: doc.mime_type,
            sizeBytes: doc.file_size,
        });
    }

    if (msg.voice) {
        attachments.push({
            kind: "audio",
            fileId: msg.voice.file_id,
            fileUniqueId: msg.voice.file_unique_id,
            fileName: `${msg.voice.file_unique_id || msg.voice.file_id}.ogg`,
            mimeType: msg.voice.mime_type || "audio/ogg",
            sizeBytes: msg.voice.file_size,
        });
    }

    if (msg.audio) {
        attachments.push({
            kind: "audio",
            fileId: msg.audio.file_id,
            fileUniqueId: msg.audio.file_unique_id,
            fileName: msg.audio.file_name || `${msg.audio.file_unique_id || msg.audio.file_id}.mp3`,
            mimeType: msg.audio.mime_type,
            sizeBytes: msg.audio.file_size,
        });
    }

    if (msg.video_note) {
        attachments.push({
            kind: "video-note",
            fileId: msg.video_note.file_id,
            fileUniqueId: msg.video_note.file_unique_id,
            fileName: `${msg.video_note.file_unique_id || msg.video_note.file_id}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: msg.video_note.file_size,
        });
    }

    return attachments;
}

async function downloadToCache(
    kind: StoredAttachmentKind,
    fileId: string,
    fileName: string,
    mimeType?: string,
    fileUniqueId?: string,
    sizeBytes?: number,
): Promise<StoredAttachment | null> {
    const startedAt = Date.now();
    logger.debug("download.start", {kind, fileId, fileName, mimeType});
    const file = await bot.getFile({file_id: fileId});
    const finalFileName = fileNameWithExtension(fileName, mimeType, file.file_path);
    const location = cachePathFor(kind, fileUniqueId, fileId, finalFileName);

    await cachePathLocks.runExclusive(location, async () => {
        if (fs.existsSync(location)) {
            logger.trace("download.cache_hit", {kind, location});
            return;
        }

        const buffer = await downloadTelegramFile(file.file_path);
        if (!buffer) {
            logger.warn("download.empty", {kind, fileId, telegramFilePath: file.file_path});
            return;
        }

        const tempLocation = `${location}.${process.pid}.${Date.now()}.tmp`;
        fs.mkdirSync(path.dirname(location), {recursive: true});
        fs.writeFileSync(tempLocation, buffer);
        fs.renameSync(tempLocation, location);
        logger.debug("download.saved", {kind, location, bytes: buffer.length, duration: logger.duration(startedAt)});
    });

    const resolvedSizeBytes = sizeBytes ?? (fs.existsSync(location) ? fs.statSync(location).size : undefined);
    return {
        kind,
        fileId,
        fileUniqueId,
        fileName: finalFileName,
        mimeType,
        cachePath: location,
        sizeBytes: resolvedSizeBytes,
        sha256: fileSha256(location),
    };
}

async function convertAudioToWav(input: string, output: string, noVideo = false): Promise<void> {
    const startedAt = Date.now();
    logger.debug("audio.convert.start", {input, output, noVideo});
    await cachePathLocks.runExclusive(output, async () => {
        if (fs.existsSync(output)) {
            logger.trace("audio.convert.cache_hit", {output});
            return;
        }

        await ffmpegSemaphore.runExclusive(async () => {
            if (fs.existsSync(output)) {
                logger.trace("audio.convert.cache_hit", {output});
                return;
            }

            const tempOutput = `${output}.${process.pid}.${Date.now()}.tmp.wav`;
            try {
                await performFFmpeg(() => {
                    const command = ffmpeg(input);
                    if (noVideo) command.noVideo();
                    return command
                        .toFormat("wav")
                        .save(tempOutput)
                        .on("progress", (progress) => {
                            logger.trace("audio.convert.progress", {input, output, progress});
                        });
                });
                fs.renameSync(tempOutput, output);
                logger.debug("audio.convert.done", {input, output, duration: logger.duration(startedAt)});
            } catch (e) {
                if (fs.existsSync(tempOutput)) {
                    fs.rmSync(tempOutput, {force: true});
                }
                logger.error("audio.convert.failed", {input, output, error: e instanceof Error ? e : String(e)});
                throw e;
            }
        });
    });
}

export async function cacheMessageAttachmentsWithRejections(msg: Message): Promise<MessageAttachmentCacheResult> {
    const startedAt = Date.now();
    const result: StoredAttachment[] = [];
    const rejected: RejectedTelegramAttachment[] = [];
    logger.debug("message.cache.start", {chatId: msg.chat?.id, messageId: msg.message_id});

    try {
        if (msg.photo?.length) {
            const size = msg.photo[msg.photo.length - 1]!;
            const fileName = `${size.file_unique_id || size.file_id}.jpg`;
            const mimeType = "image/jpeg";
            if (!rejectIfTooLarge(rejected, "image", size.file_id, fileName, mimeType, size.file_size, size.file_unique_id)) {
                const file = await downloadToCache("image", size.file_id, fileName, mimeType, size.file_unique_id, size.file_size);
                if (file) result.push(file);
            }
        }

        if (msg.document) {
            const doc = msg.document;
            const kind: StoredAttachmentKind = doc.mime_type?.startsWith("image/")
                ? "image"
                : doc.mime_type?.startsWith("audio/")
                    ? "audio"
                    : "document";
            const fileName = doc.file_name || `${doc.file_unique_id || doc.file_id}`;
            if (!rejectIfTooLarge(rejected, kind, doc.file_id, fileName, doc.mime_type, doc.file_size, doc.file_unique_id)) {
                const file = await downloadToCache(kind, doc.file_id, fileName, doc.mime_type, doc.file_unique_id, doc.file_size);
                if (file) result.push(file);
            }
        }

        if (msg.voice) {
            const fileName = `${msg.voice.file_unique_id || msg.voice.file_id}.ogg`;
            const mimeType = msg.voice.mime_type || "audio/ogg";
            const file = rejectIfTooLarge(rejected, "audio", msg.voice.file_id, fileName, mimeType, msg.voice.file_size, msg.voice.file_unique_id)
                ? null
                : await downloadToCache("audio", msg.voice.file_id, fileName, mimeType, msg.voice.file_unique_id, msg.voice.file_size);
            if (file) {
                const output = cachePathFor("audio", msg.voice.file_unique_id, msg.voice.file_id, `${msg.voice.file_unique_id || msg.voice.file_id}.wav`);
                try {
                    await convertAudioToWav(file.cachePath, output);
                    file.cachePath = output;
                    file.fileName = file?.fileName?.replace(".ogg", ".wav");
                    file.mimeType = "audio/wav";
                    file.sizeBytes = fs.existsSync(output) ? fs.statSync(output).size : file.sizeBytes;
                    file.sha256 = fileSha256(output);
                } catch (e) {
                    logError(e instanceof Error ? e : String(e));
                }
            }

            if (file) result.push(file);
        }

        if (msg.audio) {
            const fileName = msg.audio.file_name || `${msg.audio.file_unique_id || msg.audio.file_id}.mp3`;
            if (!rejectIfTooLarge(rejected, "audio", msg.audio.file_id, fileName, msg.audio.mime_type, msg.audio.file_size, msg.audio.file_unique_id)) {
                const file = await downloadToCache("audio", msg.audio.file_id, fileName, msg.audio.mime_type, msg.audio.file_unique_id, msg.audio.file_size);
                if (file) result.push(file);
            }
        }

        if (msg.video_note) {
            const fileName = `${msg.video_note.file_unique_id || msg.video_note.file_id}.mp4`;
            const mimeType = "video/mp4";
            const file = rejectIfTooLarge(rejected, "video-note", msg.video_note.file_id, fileName, mimeType, msg.video_note.file_size, msg.video_note.file_unique_id)
                ? null
                : await downloadToCache("video-note", msg.video_note.file_id, fileName, mimeType, msg.video_note.file_unique_id, msg.video_note.file_size);
            if (file) {
                const output = cachePathFor("audio", msg.video_note.file_unique_id, msg.video_note.file_id, `${msg.video_note.file_unique_id || msg.video_note.file_id}.wav`);
                try {
                    await convertAudioToWav(file.cachePath, output, true);
                    file.cachePath = output;
                    file.fileName = file?.fileName?.replace(".mp4", ".wav");
                    file.mimeType = "audio/wav";
                    file.sizeBytes = fs.existsSync(output) ? fs.statSync(output).size : file.sizeBytes;
                    file.sha256 = fileSha256(output);
                } catch (e) {
                    logError(e instanceof Error ? e : String(e));
                }
            }

            if (file) result.push(file);
        }
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
    }

    logger.debug("message.cache.done", {
        chatId: msg.chat?.id,
        messageId: msg.message_id,
        attachments: result.length,
        rejected: rejected.length,
        duration: logger.duration(startedAt),
    });
    return {attachments: result, rejected};
}

export async function cacheMessageAttachments(msg: Message): Promise<StoredAttachment[]> {
    const {attachments} = await cacheMessageAttachmentsWithRejections(msg);
    return attachments;
}

export function attachmentsToDownloadedFiles(attachments: StoredAttachment[]): AiDownloadedFile[] {
    logger.trace("downloaded_files.build", {attachments: attachments.length});
    return attachments
        .filter(attachment => fs.existsSync(attachment.cachePath))
        .flatMap(attachment => {
            const sizeBytes = attachment.sizeBytes ?? fs.statSync(attachment.cachePath).size;
            if (sizeBytes > PIPELINE_ATTACHMENT_LIMIT_BYTES) {
                logger.warn("downloaded_files.skipped.too_large", {
                    kind: attachment.kind,
                    fileName: attachment.fileName,
                    sizeBytes,
                    limitBytes: PIPELINE_ATTACHMENT_LIMIT_BYTES,
                });
                return [];
            }

            return [{
                kind: attachment.kind,
                fileId: attachment.fileId,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                buffer: fs.readFileSync(attachment.cachePath),
                path: attachment.cachePath,
                sizeBytes,
                sha256: attachment.sha256,
            }];
        });
}

export function cleanupDownloads(files: AiDownloadedFile[]): void {
    logger.trace("downloaded_files.cleanup", {files: files.length});
    // Files stay on disk in the message cache; drop in-memory buffers eagerly.
    for (const file of files) {
        file.buffer = Buffer.alloc(0);
    }
    files.length = 0;
}
