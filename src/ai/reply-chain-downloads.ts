import type {AiDownloadedFile} from "./telegram-attachments.js";

function downloadKey(download: AiDownloadedFile): string {
    return [
        download.kind,
        download.fileId,
        download.sha256 ?? "",
        download.fileName,
    ].join(":");
}

export function mergeReplyChainDownloads(
    currentDownloads: readonly AiDownloadedFile[],
    replyChainDownloads: readonly AiDownloadedFile[],
): AiDownloadedFile[] {
    const result: AiDownloadedFile[] = [];
    const seen = new Set<string>();

    for (const download of [...currentDownloads, ...replyChainDownloads]) {
        const key = downloadKey(download);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(download);
    }

    return result;
}

export function shouldPreferCurrentDownloads(text: string, currentDownloads: readonly AiDownloadedFile[]): boolean {
    if (!currentDownloads.length) return false;

    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;

    return normalized.includes("this file")
        || normalized.includes("this document")
        || normalized.includes("этот файл")
        || normalized.includes("этот документ");
}
