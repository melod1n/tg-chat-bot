import {AiProvider} from "../model/ai-provider";
import type {StoredAttachment} from "../model/stored-attachment";
import type {AiDownloadedFile} from "./telegram-attachments";
import {persistInternalJsonArtifactAttachment} from "./internal-artifact-store";

export async function persistTranscriptArtifactAttachment(params: {
    provider: AiProvider;
    transcript: string;
    downloads: AiDownloadedFile[];
    chatId: number;
    messageId: number;
}): Promise<StoredAttachment | undefined> {
    const text = params.transcript.trim();
    if (!text) return Promise.resolve(undefined);

    const sources = params.downloads
        .filter(download => download.kind === "audio" || download.kind === "video-note")
        .map(download => ({
            fileId: download.fileId,
            fileName: download.fileName,
            mimeType: download.mimeType,
            sizeBytes: download.sizeBytes ?? download.buffer.length,
            sha256: download.sha256,
        }));

    return await persistInternalJsonArtifactAttachment({
        artifactKind: "transcript",
        fileNamePrefix: "transcript",
        chatId: params.chatId,
        messageId: params.messageId,
        payload: {
            provider: params.provider,
            transcript: text,
            sources,
        },
        metadata: {
            provider: params.provider,
            sourceFileNames: sources.map(source => source.fileName),
            transcriptChars: text.length,
        },
    });
}
