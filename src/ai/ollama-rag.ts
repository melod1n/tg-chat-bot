import path from "node:path";
import zlib from "node:zlib";
import {Ollama} from "ollama";
import {AiDownloadedFile} from "./telegram-attachments";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {OllamaChatMessage} from "./ollama-chat-message";
import {Environment} from "../common/environment";

export type OllamaDocumentRagConfig = {
    embeddingModel: string;
    embeddingClient?: Ollama;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    maxContextChars: number;
    minScore: number;
    maxArchiveFiles: number;
    maxArchiveBytes: number;
    maxArchiveDepth: number;
};

type SourceDocument = {
    documentIndex: number;
    fileName: string;
    text: string;
};

type SkippedDocument = {
    documentIndex: number;
    fileName: string;
    reason: string;
};

type DocumentChunk = {
    sourceId: string;
    documentIndex: number;
    documentName: string;
    chunkIndex: number;
    chunkCount: number;
    text: string;
    score?: number;
};

const EMBEDDING_BATCH_SIZE = 32;
const TAR_BLOCK_SIZE = 512;

const TEXT_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".rst",
    ".csv",
    ".json",
    ".jsonl",
    ".xml",
    ".html",
    ".htm",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".env",
    ".conf",
    ".properties",
    ".log",
    ".ps1",
    ".sh",
    ".bat",
    ".cmd",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".rb",
    ".go",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".php",
    ".sql",
    ".patch"
]);

const ZIP_MIME_TYPES = new Set([
    "application/zip",
    "application/x-zip",
    "application/x-zip-compressed",
    "multipart/x-zip",
]);

const TAR_MIME_TYPES = new Set([
    "application/x-tar",
    "application/tar",
]);

const GZIP_MIME_TYPES = new Set([
    "application/gzip",
    "application/x-gzip",
    "application/gzip-compressed",
]);

function isPlainTextDocument(doc: AiDownloadedFile): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    const mime = (doc.mimeType ?? "").toLowerCase();

    return mime.startsWith("text/")
        || mime === "application/json"
        || mime === "application/xml"
        || TEXT_EXTENSIONS.has(ext);
}

function isPdfDocument(doc: AiDownloadedFile): boolean {
    return path.extname(doc.fileName).toLowerCase() === ".pdf"
        || (doc.mimeType ?? "").toLowerCase() === "application/pdf";
}

function isDocxDocument(doc: AiDownloadedFile): boolean {
    return path.extname(doc.fileName).toLowerCase() === ".docx"
        || (doc.mimeType ?? "").toLowerCase() === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function lowerFileName(fileName: string): string {
    return fileName.toLowerCase();
}

function isZipArchiveDocument(doc: AiDownloadedFile): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    const mime = (doc.mimeType ?? "").toLowerCase();
    return ext === ".zip" || ZIP_MIME_TYPES.has(mime);
}

function isTarArchiveDocument(doc: AiDownloadedFile): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    const mime = (doc.mimeType ?? "").toLowerCase();
    return ext === ".tar" || TAR_MIME_TYPES.has(mime);
}

function isTarGzipArchiveDocument(doc: AiDownloadedFile): boolean {
    const name = lowerFileName(doc.fileName);
    return name.endsWith(".tar.gz") || name.endsWith(".tgz");
}

function isGzipDocument(doc: AiDownloadedFile): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    const mime = (doc.mimeType ?? "").toLowerCase();
    return ext === ".gz" || GZIP_MIME_TYPES.has(mime);
}

function isArchiveDocument(doc: AiDownloadedFile): boolean {
    if (isDocxDocument(doc)) return false;
    return isZipArchiveDocument(doc)
        || isTarGzipArchiveDocument(doc)
        || isTarArchiveDocument(doc)
        || isGzipDocument(doc);
}

function normalizeDocumentText(value: string): string {
    return value
        .replace(/\u0000/g, "")
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
        .replace(/\p{Private_Use}/gu, " ")
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function decodeTextDocument(doc: AiDownloadedFile): string {
    return normalizeDocumentText(doc.buffer.toString("utf8"));
}

function streamHasFlateDecode(header: string): boolean {
    return /\/Filter\s*(?:\/FlateDecode|\[[\s\S]*?\/FlateDecode[\s\S]*?\])/.test(header);
}

function extractPdfStreams(buffer: Buffer, raw: string): Buffer[] {
    const streams: Buffer[] = [];
    const streamToken = /stream(?:\r\n|\n|\r)/g;
    let match: RegExpExecArray | null;

    while ((match = streamToken.exec(raw))) {
        const dataStart = streamToken.lastIndex;
        const endstream = raw.indexOf("endstream", dataStart);
        if (endstream < 0) break;

        let dataEnd = endstream;
        while (dataEnd > dataStart) {
            const previous = raw.charCodeAt(dataEnd - 1);
            if (previous !== 10 && previous !== 13) break;
            dataEnd--;
        }

        const header = raw.slice(Math.max(0, match.index - 2048), match.index);
        const stream = buffer.subarray(dataStart, dataEnd);

        if (streamHasFlateDecode(header)) {
            try {
                streams.push(zlib.inflateSync(stream));
            } catch {
                streams.push(stream);
            }
        } else {
            streams.push(stream);
        }

        streamToken.lastIndex = endstream + "endstream".length;
    }

    return streams;
}

function isOctalDigit(value: string): boolean {
    return value >= "0" && value <= "7";
}

function decodePdfBytes(bytes: number[]): string {
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        let text = "";
        for (let i = 2; i + 1 < bytes.length; i += 2) {
            text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        }
        return text;
    }

    const buffer = Buffer.from(bytes);
    const utf8 = buffer.toString("utf8");
    const replacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
    return replacementCount > Math.max(1, bytes.length * 0.02)
        ? buffer.toString("latin1")
        : utf8;
}

function decodePdfLiteralString(raw: string): string {
    const bytes: number[] = [];

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== "\\") {
            bytes.push(raw.charCodeAt(i) & 0xFF);
            continue;
        }

        const next = raw[++i];
        if (!next) break;

        switch (next) {
            case "n":
                bytes.push(10);
                break;
            case "r":
                bytes.push(13);
                break;
            case "t":
                bytes.push(9);
                break;
            case "b":
                bytes.push(8);
                break;
            case "f":
                bytes.push(12);
                break;
            case "(":
            case ")":
            case "\\":
                bytes.push(next.charCodeAt(0));
                break;
            case "\r":
                if (raw[i + 1] === "\n") i++;
                break;
            case "\n":
                break;
            default:
                if (isOctalDigit(next)) {
                    let octal = next;
                    for (let j = 0; j < 2 && isOctalDigit(raw[i + 1] ?? ""); j++) {
                        octal += raw[++i];
                    }
                    bytes.push(Number.parseInt(octal, 8) & 0xFF);
                } else {
                    bytes.push(next.charCodeAt(0) & 0xFF);
                }
        }
    }

    return decodePdfBytes(bytes);
}

function decodePdfHexString(raw: string): string {
    let hex = raw.replace(/[^0-9A-Fa-f]/g, "");
    if (!hex.length) return "";
    if (hex.length % 2 !== 0) hex += "0";

    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
    }

    return decodePdfBytes(bytes);
}

function readPdfLiteralOperand(input: string, start: number): { value: string; nextIndex: number } | null {
    let depth = 1;
    let raw = "";

    for (let i = start + 1; i < input.length; i++) {
        const ch = input[i];

        if (ch === "\\") {
            raw += ch;
            if (i + 1 < input.length) raw += input[++i];
            continue;
        }

        if (ch === "(") {
            depth++;
            raw += ch;
            continue;
        }

        if (ch === ")") {
            depth--;
            if (depth === 0) {
                return {value: decodePdfLiteralString(raw), nextIndex: i + 1};
            }
            raw += ch;
            continue;
        }

        raw += ch;
    }

    return null;
}

function readPdfHexOperand(input: string, start: number): { value: string; nextIndex: number } | null {
    const end = input.indexOf(">", start + 1);
    if (end < 0) return null;
    return {value: decodePdfHexString(input.slice(start + 1, end)), nextIndex: end + 1};
}

function extractPdfStringOperands(input: string): string[] {
    const values: string[] = [];

    for (let i = 0; i < input.length; i++) {
        if (input[i] === "(") {
            const literal = readPdfLiteralOperand(input, i);
            if (!literal) continue;
            values.push(literal.value);
            i = literal.nextIndex - 1;
            continue;
        }

        if (input[i] === "<" && input[i + 1] !== "<") {
            const hex = readPdfHexOperand(input, i);
            if (!hex) continue;
            values.push(hex.value);
            i = hex.nextIndex - 1;
        }
    }

    return values;
}

function extractPdfOperatorText(content: string): string {
    const blocks = [...content.matchAll(/BT([\s\S]*?)ET/g)].map(match => match[1] ?? "");
    const target = blocks.length ? blocks.join("\n") : content;
    const parts: string[] = [];

    for (const match of target.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
        const text = extractPdfStringOperands(match[1] ?? "").join("");
        if (text.trim()) parts.push(text);
    }

    for (const match of target.matchAll(/(\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]+>)\s*(?:Tj|'|")/g)) {
        const operand = match[1] ?? "";
        const text = operand.startsWith("(")
            ? (readPdfLiteralOperand(operand, 0)?.value ?? "")
            : decodePdfHexString(operand.slice(1, -1));
        if (text.trim()) parts.push(text);
    }

    return normalizeDocumentText(parts.join(" "));
}

function extractPdfText(buffer: Buffer): string {
    const raw = buffer.toString("latin1");
    const texts = extractPdfStreams(buffer, raw)
        .map(stream => extractPdfOperatorText(stream.toString("latin1")))
        .filter(text => text.trim().length > 0);

    if (texts.length) {
        return normalizeDocumentText(texts.join("\n"));
    }

    return extractPdfOperatorText(raw);
}

type ZipEntry = {
    name: string;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
};

function findZipEndOfCentralDirectory(buffer: Buffer): number {
    const min = Math.max(0, buffer.length - 0xFFFF - 22);

    for (let i = buffer.length - 22; i >= min; i--) {
        if (buffer.readUInt32LE(i) === 0x06054B50) return i;
    }

    throw new Error(Environment.zipCentralDirectoryNotFoundText);
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
    const eocd = findZipEndOfCentralDirectory(buffer);
    const entryCount = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    const entries: ZipEntry[] = [];

    for (let i = 0; i < entryCount; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014B50) {
            throw new Error(Environment.zipInvalidCentralDirectoryText);
        }

        const generalPurposeBitFlag = buffer.readUInt16LE(offset + 8);
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

        entries.push({
            name,
            compressionMethod,
            generalPurposeBitFlag,
            compressedSize,
            uncompressedSize,
            localHeaderOffset
        });
        offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
    const offset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(offset) !== 0x04034B50) {
        throw new Error(Environment.getZipInvalidLocalHeaderText(entry.name));
    }

    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) return compressed;
    if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);

    throw new Error(Environment.getZipUnsupportedCompressionMethodText(entry.compressionMethod, entry.name));
}

type ExtractedRagDocument = {
    fileName: string;
    text: string;
};

export type OllamaRagArtifactDetails = {
    query: string;
    extractedDocuments: Array<{
        documentIndex: number;
        fileName: string;
        textChars: number;
    }>;
    selectedChunks: Array<{
        sourceId: string;
        documentIndex: number;
        documentName: string;
        chunkIndex: number;
        chunkCount: number;
        textChars: number;
        score?: number;
    }>;
    skippedDocuments: Array<{
        documentIndex: number;
        fileName: string;
        reason: string;
    }>;
    providerState: {
        embeddingModel: string;
        topK: number;
        chunkSize: number;
        chunkOverlap: number;
        maxContextChars: number;
        minScore: number;
        maxArchiveFiles: number;
        maxArchiveBytes: number;
        maxArchiveDepth: number;
    };
};

type ArchiveSkippedDocument = {
    fileName: string;
    reason: string;
};

type ArchiveExtractionState = {
    fileCount: number;
    uncompressedBytes: number;
    skipped: ArchiveSkippedDocument[];
};

function mimeTypeFromFileName(fileName: string): string | undefined {
    const name = lowerFileName(fileName);
    const ext = path.extname(name);

    if (name.endsWith(".tar.gz") || ext === ".tgz") return "application/gzip";

    switch (ext) {
        case ".txt":
        case ".md":
        case ".markdown":
        case ".rst":
        case ".csv":
        case ".log":
        case ".ini":
        case ".env":
        case ".conf":
        case ".properties":
            return "text/plain";
        case ".html":
        case ".htm":
            return "text/html";
        case ".json":
        case ".jsonl":
            return "application/json";
        case ".xml":
            return "application/xml";
        case ".yaml":
        case ".yml":
            return "application/yaml";
        case ".pdf":
            return "application/pdf";
        case ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        case ".zip":
            return "application/zip";
        case ".tar":
            return "application/x-tar";
        case ".gz":
            return "application/gzip";
        default:
            return undefined;
    }
}

function normalizeArchiveEntryName(name: string): string | null {
    const withoutNulls = name.replace(/\u0000/g, "");
    const normalized = path.posix.normalize(withoutNulls.replace(/\\/g, "/").replace(/^\/+/, ""));

    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
        return null;
    }

    return normalized;
}

function isIgnorableArchiveEntry(name: string): boolean {
    const parts = name.split("/");
    const base = parts[parts.length - 1] ?? "";
    return parts.includes("__MACOSX") || base === ".DS_Store" || base.length === 0;
}

function archiveEntryDoc(parent: AiDownloadedFile, entryName: string, buffer: Buffer): AiDownloadedFile {
    const fileName = `${parent.fileName}/${entryName}`;
    return {
        kind: "document",
        fileId: `${parent.fileId}:${entryName}`,
        fileName,
        mimeType: mimeTypeFromFileName(entryName),
        buffer,
        path: `${parent.path}!${entryName}`,
    };
}

function reserveArchiveFile(
    state: ArchiveExtractionState,
    config: OllamaDocumentRagConfig,
    fileName: string,
    uncompressedBytes: number,
): boolean {
    if (state.fileCount >= config.maxArchiveFiles) {
        state.skipped.push({
            fileName,
            reason: `archive file limit exceeded (${config.maxArchiveFiles})`,
        });
        return false;
    }

    if (uncompressedBytes > config.maxArchiveBytes || state.uncompressedBytes + uncompressedBytes > config.maxArchiveBytes) {
        state.skipped.push({
            fileName,
            reason: `uncompressed data limit exceeded (${config.maxArchiveBytes} bytes)`,
        });
        return false;
    }

    state.fileCount++;
    state.uncompressedBytes += uncompressedBytes;
    return true;
}

function pushArchiveSkip(state: ArchiveExtractionState, fileName: string, reason: Error | string | object | null | undefined): void {
    state.skipped.push({
        fileName,
        reason: reason instanceof Error ? reason.message : String(reason),
    });
}

function extractArchiveChildDocuments(
    parent: AiDownloadedFile,
    entryName: string,
    buffer: Buffer,
    config: OllamaDocumentRagConfig,
    state: ArchiveExtractionState,
    depth: number,
): ExtractedRagDocument[] {
    const child = archiveEntryDoc(parent, entryName, buffer);

    try {
        return extractRagDocumentsFromFile(child, config, state, depth + 1);
    } catch (e) {
        pushArchiveSkip(state, child.fileName, e instanceof Error ? e : String(e));
        return [];
    }
}

function extractZipArchiveDocuments(
    doc: AiDownloadedFile,
    config: OllamaDocumentRagConfig,
    state: ArchiveExtractionState,
    depth: number,
): ExtractedRagDocument[] {
    const documents: ExtractedRagDocument[] = [];

    for (const entry of listZipEntries(doc.buffer)) {
        const normalizedName = normalizeArchiveEntryName(entry.name);
        if (!normalizedName || normalizedName.endsWith("/") || isIgnorableArchiveEntry(normalizedName)) continue;

        const displayName = `${doc.fileName}/${normalizedName}`;
        if ((entry.generalPurposeBitFlag & 1) !== 0) {
            pushArchiveSkip(state, displayName, "encrypted ZIP entries are not supported");
            continue;
        }

        if (entry.compressedSize === 0xFFFFFFFF || entry.uncompressedSize === 0xFFFFFFFF) {
            pushArchiveSkip(state, displayName, "ZIP64 entries are not supported yet");
            continue;
        }

        if (!reserveArchiveFile(state, config, displayName, entry.uncompressedSize)) continue;

        try {
            const buffer = readZipEntry(doc.buffer, entry);
            documents.push(...extractArchiveChildDocuments(doc, normalizedName, buffer, config, state, depth));
        } catch (e) {
            pushArchiveSkip(state, displayName, e instanceof Error ? e : String(e));
        }
    }

    return documents;
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
    const slice = buffer.subarray(offset, offset + length);
    const nullIndex = slice.indexOf(0);
    return slice
        .subarray(0, nullIndex >= 0 ? nullIndex : slice.length)
        .toString("utf8")
        .trim();
}

function readTarSize(buffer: Buffer, offset: number): number {
    const raw = buffer.subarray(offset, offset + 12);

    if ((raw[0] & 0x80) !== 0) {
        let size = BigInt(raw[0] & 0x7F);
        for (let i = 1; i < raw.length; i++) {
            size = (size << 8n) + BigInt(raw[i]);
        }
        if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(Environment.tarFileTooLargeText);
        return Number(size);
    }

    const text = raw.toString("ascii").replace(/\u0000/g, "").trim();
    if (!text) return 0;
    const size = Number.parseInt(text, 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(Environment.tarInvalidEntrySizeText);
    return size;
}

function isTarZeroBlock(buffer: Buffer, offset: number): boolean {
    if (offset + TAR_BLOCK_SIZE > buffer.length) return false;

    for (let i = offset; i < offset + TAR_BLOCK_SIZE; i++) {
        if (buffer[i] !== 0) return false;
    }

    return true;
}

function tarDataEnd(dataStart: number, size: number): number {
    return dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

function parsePaxPath(buffer: Buffer): string | undefined {
    const text = buffer.toString("utf8");
    let offset = 0;

    while (offset < text.length) {
        const spaceIndex = text.indexOf(" ", offset);
        if (spaceIndex < 0) break;

        const recordLength = Number.parseInt(text.slice(offset, spaceIndex), 10);
        if (!Number.isSafeInteger(recordLength) || recordLength <= 0) break;

        const record = text.slice(spaceIndex + 1, offset + recordLength).replace(/\n$/, "");
        const eqIndex = record.indexOf("=");
        if (eqIndex > 0 && record.slice(0, eqIndex) === "path") {
            return record.slice(eqIndex + 1);
        }

        offset += recordLength;
    }

    return undefined;
}

function bufferLooksLikeTar(buffer: Buffer): boolean {
    if (buffer.length < TAR_BLOCK_SIZE) return false;
    return buffer.subarray(257, 263).toString("ascii").startsWith("ustar");
}

function extractTarArchiveDocuments(
    doc: AiDownloadedFile,
    config: OllamaDocumentRagConfig,
    state: ArchiveExtractionState,
    depth: number,
): ExtractedRagDocument[] {
    const documents: ExtractedRagDocument[] = [];
    let offset = 0;
    let pendingLongName: string | undefined;
    let pendingPaxPath: string | undefined;

    while (offset + TAR_BLOCK_SIZE <= doc.buffer.length) {
        if (isTarZeroBlock(doc.buffer, offset)) break;

        const name = readTarString(doc.buffer, offset, 100);
        const size = readTarSize(doc.buffer, offset + 124);
        const typeFlag = String.fromCharCode(doc.buffer[offset + 156] || 0);
        const prefix = readTarString(doc.buffer, offset + 345, 155);
        const dataStart = offset + TAR_BLOCK_SIZE;
        const dataEnd = dataStart + size;

        if (dataEnd > doc.buffer.length) {
            throw new Error(Environment.tarEntryExceedsBoundsText);
        }

        const payload = doc.buffer.subarray(dataStart, dataEnd);
        offset = tarDataEnd(dataStart, size);

        if (typeFlag === "L") {
            pendingLongName = payload.toString("utf8").replace(/\u0000.*$/s, "").trim();
            continue;
        }

        if (typeFlag === "x") {
            pendingPaxPath = parsePaxPath(payload);
            continue;
        }

        const rawName = pendingPaxPath || pendingLongName || (prefix ? `${prefix}/${name}` : name);
        pendingLongName = undefined;
        pendingPaxPath = undefined;

        const normalizedName = normalizeArchiveEntryName(rawName);
        if (!normalizedName || normalizedName.endsWith("/") || isIgnorableArchiveEntry(normalizedName)) continue;
        if (typeFlag !== "0" && typeFlag !== "\u0000" && typeFlag !== "") continue;

        const displayName = `${doc.fileName}/${normalizedName}`;
        if (!reserveArchiveFile(state, config, displayName, size)) continue;

        documents.push(...extractArchiveChildDocuments(doc, normalizedName, payload, config, state, depth));
    }

    return documents;
}

function gzipInnerName(fileName: string): string {
    const name = lowerFileName(fileName);
    if (name.endsWith(".tgz")) return path.basename(fileName, path.extname(fileName)) + ".tar";
    if (name.endsWith(".tar.gz")) return fileName.slice(0, -3);
    if (name.endsWith(".gz")) return fileName.slice(0, -3);
    return `${fileName}.unpacked`;
}

function extractGzipDocuments(
    doc: AiDownloadedFile,
    config: OllamaDocumentRagConfig,
    state: ArchiveExtractionState,
    depth: number,
): ExtractedRagDocument[] {
    const inflated = zlib.gunzipSync(doc.buffer, {maxOutputLength: config.maxArchiveBytes + 1});
    if (inflated.length > config.maxArchiveBytes) {
        throw new Error(Environment.getGzipUncompressedLimitText(config.maxArchiveBytes));
    }

    const innerName = gzipInnerName(doc.fileName);
    const tarGzip = isTarGzipArchiveDocument(doc) || bufferLooksLikeTar(inflated);
    if (tarGzip) {
        const tarDoc: AiDownloadedFile = {
            ...doc,
            fileName: doc.fileName,
            mimeType: "application/x-tar",
            buffer: inflated,
            path: `${doc.path}!${innerName}`,
        };
        return extractTarArchiveDocuments(tarDoc, config, state, depth);
    }

    if (!reserveArchiveFile(state, config, `${doc.fileName}/${innerName}`, inflated.length)) return [];
    return extractArchiveChildDocuments(doc, innerName, inflated, config, state, depth);
}

function extractArchiveDocuments(
    doc: AiDownloadedFile,
    config: OllamaDocumentRagConfig,
    state: ArchiveExtractionState,
    depth: number,
): ExtractedRagDocument[] {
    if (depth >= config.maxArchiveDepth) {
        throw new Error(Environment.getNestedArchiveDepthLimitText(config.maxArchiveDepth));
    }

    if (isZipArchiveDocument(doc)) return extractZipArchiveDocuments(doc, config, state, depth);
    if (isTarGzipArchiveDocument(doc) || isGzipDocument(doc)) return extractGzipDocuments(doc, config, state, depth);
    if (isTarArchiveDocument(doc)) return extractTarArchiveDocuments(doc, config, state, depth);

    throw new Error(Environment.getUnsupportedArchiveFormatText(doc.fileName));
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function extractDocxXmlText(xml: string): string {
    const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
        .map(match => {
            const paragraphXml = match[0];
            const parts: string[] = [];

            for (const run of paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g)) {
                if (run[1] !== undefined) {
                    parts.push(decodeXmlEntities(run[1]));
                } else {
                    parts.push("\n");
                }
            }

            return parts.join("");
        })
        .map(paragraph => paragraph.trim())
        .filter(paragraph => paragraph.length > 0);

    return normalizeDocumentText(paragraphs.join("\n\n"));
}

function extractDocxText(buffer: Buffer): string {
    const entries = listZipEntries(buffer);
    const textEntryNames = entries
        .map(entry => entry.name)
        .filter(name => /^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i.test(name));

    if (!textEntryNames.includes("word/document.xml")) {
        throw new Error(Environment.docxDocumentXmlMissingText);
    }

    const entryByName = new Map(entries.map(entry => [entry.name, entry]));
    const texts = textEntryNames
        .map(name => entryByName.get(name))
        .filter((entry): entry is ZipEntry => !!entry)
        .map(entry => extractDocxXmlText(readZipEntry(buffer, entry).toString("utf8")))
        .filter(text => text.trim().length > 0);

    return normalizeDocumentText(texts.join("\n\n"));
}

function utf8ReplacementRatio(value: string): number {
    if (!value.length) return 0;
    return (value.match(/\uFFFD/g) ?? []).length / value.length;
}

function documentTextLooksReadable(text: string): boolean {
    const compact = text.replace(/\s+/g, "");
    if (compact.length < 24) return compact.length > 0;

    const replacements = utf8ReplacementRatio(text);
    if (replacements > 0.03) return false;

    const lettersAndNumbers = compact.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    const readableRatio = lettersAndNumbers / compact.length;
    if (readableRatio < 0.45) return false;

    const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu) ?? [];
    if (compact.length > 80 && words.length < 6) return false;

    const veryLongTokens = words.filter(word => word.length > 80).length;
    return veryLongTokens <= Math.max(1, Math.floor(words.length * 0.05));
}

function assertReadableDocumentText(doc: AiDownloadedFile, text: string): string {
    const normalized = normalizeDocumentText(text);
    if (!normalized.trim()) {
        throw new Error(Environment.getDocumentEmptyOrNoExtractableText(doc.fileName));
    }

    if (documentTextLooksReadable(normalized)) return normalized;

    const ext = path.extname(doc.fileName).toLowerCase();
    const format = ext || doc.mimeType || "this format";
    throw new Error(
        `Could not extract readable text from "${doc.fileName}" (${format}). ` +
        "Local RAG does not send documents to third-party providers and can only read the available text layer. " +
        "If this is a scan, image, or PDF with non-standard font encoding, OCR or a text version of the document is required."
    );
}

function extractDocumentText(doc: AiDownloadedFile): string {
    let text: string;

    if (isPlainTextDocument(doc)) {
        text = decodeTextDocument(doc);
        return assertReadableDocumentText(doc, text);
    }

    if (isPdfDocument(doc)) {
        text = extractPdfText(doc.buffer);
        return assertReadableDocumentText(doc, text);
    }

    if (isDocxDocument(doc)) {
        text = extractDocxText(doc.buffer);
        return assertReadableDocumentText(doc, text);
    }

    throw new Error(Environment.getUnsupportedLocalRagDocumentFormatText(doc.fileName));
}

function extractRagDocumentsFromFile(
    doc: AiDownloadedFile,
    config: OllamaDocumentRagConfig,
    state: ArchiveExtractionState,
    depth = 0,
): ExtractedRagDocument[] {
    if (isArchiveDocument(doc)) {
        return extractArchiveDocuments(doc, config, state, depth);
    }

    const text = extractDocumentText(doc);
    return [{
        fileName: doc.fileName,
        text,
    }];
}

function extractRagDocuments(doc: AiDownloadedFile, config: OllamaDocumentRagConfig): {
    documents: ExtractedRagDocument[];
    skipped: ArchiveSkippedDocument[];
} {
    const state: ArchiveExtractionState = {
        fileCount: 0,
        uncompressedBytes: 0,
        skipped: [],
    };

    return {
        documents: extractRagDocumentsFromFile(doc, config, state),
        skipped: state.skipped,
    };
}

function tailText(value: string, maxLength: number): string {
    if (maxLength <= 0 || value.length <= maxLength) return value;
    return value.slice(value.length - maxLength).replace(/^\S+\s+/, "").trim();
}

function splitLongSegment(segment: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < segment.length) {
        let end = Math.min(segment.length, start + chunkSize);

        if (end < segment.length) {
            const window = segment.slice(start, end);
            const boundary = Math.max(
                window.lastIndexOf("\n"),
                window.lastIndexOf(". "),
                window.lastIndexOf("! "),
                window.lastIndexOf("? "),
                window.lastIndexOf("; "),
            );

            if (boundary > chunkSize * 0.55) {
                end = start + boundary + 1;
            }
        }

        chunks.push(segment.slice(start, end).trim());
        if (end >= segment.length) break;
        start = Math.max(start + 1, end - overlap);
    }

    return chunks.filter(chunk => chunk.length > 0);
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    const paragraphs = normalizeDocumentText(text)
        .split(/\n{2,}/)
        .map(paragraph => paragraph.trim())
        .filter(paragraph => paragraph.length > 0);

    let current = "";

    const flush = () => {
        if (!current.trim()) return;
        chunks.push(current.trim());
        current = "";
    };

    for (const paragraph of paragraphs) {
        if (paragraph.length > chunkSize) {
            flush();
            chunks.push(...splitLongSegment(paragraph, chunkSize, overlap));
            continue;
        }

        if (!current) {
            current = paragraph;
            continue;
        }

        const candidate = `${current}\n\n${paragraph}`;
        if (candidate.length <= chunkSize) {
            current = candidate;
            continue;
        }

        const overlapText = tailText(current, overlap);
        flush();
        current = overlapText && overlapText.length + paragraph.length + 2 <= chunkSize
            ? `${overlapText}\n\n${paragraph}`
            : paragraph;
    }

    flush();
    return chunks;
}

function buildChunks(documents: SourceDocument[], config: OllamaDocumentRagConfig): DocumentChunk[] {
    return documents.flatMap(document => {
        const texts = chunkText(document.text, config.chunkSize, config.chunkOverlap);
        return texts.map((text, chunkIndex) => ({
            sourceId: `doc${document.documentIndex + 1}-${chunkIndex + 1}`,
            documentIndex: document.documentIndex,
            documentName: document.fileName,
            chunkIndex,
            chunkCount: texts.length,
            text,
        }));
    });
}

async function embedTexts(model: string, texts: string[], ollama?: Ollama): Promise<number[][]> {
    if (!ollama) return [];

    const result: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
        const response = await ollama.embed({
            model: model,
            input: batch,
            truncate: true,
            keep_alive: 0
        });

        if (!Array.isArray(response.embeddings) || response.embeddings.length !== batch.length) {
            throw new Error(Environment.getOllamaEmbeddingInvalidResponseText(model));
        }

        result.push(...response.embeddings);
    }

    return result;
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    const size = Math.min(a.length, b.length);

    for (let i = 0; i < size; i++) {
        dot += a[i] * b[i];
        aNorm += a[i] * a[i];
        bNorm += b[i] * b[i];
    }

    if (!aNorm || !bNorm) return 0;
    return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function cleanOllamaUserContent(value: string): string {
    return value
        .replace(/^\[user_info\]:[\s\S]*?\n\n/, "")
        .trim();
}

function buildRetrievalQuery(userQuery: string, messages: OllamaChatMessage[]): string {
    const direct = cleanOllamaUserContent(userQuery);
    if (direct.length) return direct;

    const lastUser = [...messages].reverse().find(message => message.role === "user" && message.content.trim().length > 0);
    if (lastUser) {
        const content = cleanOllamaUserContent(lastUser.content);
        if (content.length) return content;
    }

    return "Create a brief summary of the document and list the key points.";
}

function selectWithinContext(chunks: DocumentChunk[], maxContextChars: number): DocumentChunk[] {
    const selected: DocumentChunk[] = [];
    let chars = 0;

    for (const chunk of chunks) {
        if (chars + chunk.text.length > maxContextChars && selected.length) break;
        selected.push(chunk);
        chars += chunk.text.length;
    }

    return selected;
}

function chunkKey(chunk: DocumentChunk): string {
    return `${chunk.sourceId}:${chunk.chunkIndex}`;
}

async function retrieveChunks(
    chunks: DocumentChunk[],
    query: string,
    config: OllamaDocumentRagConfig,
): Promise<DocumentChunk[]> {
    if (!config.embeddingModel.trim()) {
        throw new Error(Environment.localRagEmbeddingModelRequiredText);
    }

    const embeddings = await embedTexts(config.embeddingModel, [query, ...chunks.map(chunk => chunk.text)], config.embeddingClient);
    const queryEmbedding = embeddings[0];
    const chunkEmbeddings = embeddings.slice(1);

    const ranked = chunks
        .map((chunk, index) => ({
            ...chunk,
            score: cosineSimilarity(queryEmbedding, chunkEmbeddings[index] ?? []),
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const selected: DocumentChunk[] = [];
    const selectedKeys = new Set<string>();
    let chars = 0;

    const addChunk = (chunk: DocumentChunk, force = false): boolean => {
        const key = chunkKey(chunk);
        if (selectedKeys.has(key)) return false;
        if (selected.length >= config.topK) return false;
        if (!force && (chunk.score ?? 0) < config.minScore && selected.length >= Math.min(3, config.topK)) return false;
        if (chars + chunk.text.length > config.maxContextChars && selected.length) return false;

        selected.push(chunk);
        selectedKeys.add(key);
        chars += chunk.text.length;
        return true;
    };

    const bestChunkByDocument = new Map<number, DocumentChunk>();
    for (const chunk of ranked) {
        if (!bestChunkByDocument.has(chunk.documentIndex)) {
            bestChunkByDocument.set(chunk.documentIndex, chunk);
        }
    }

    if (bestChunkByDocument.size > 1) {
        const perDocumentTop = [...bestChunkByDocument.values()]
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        for (const chunk of perDocumentTop) {
            addChunk(chunk, true);
        }
    }

    for (const chunk of ranked) {
        addChunk(chunk);
    }

    return selected.length
        ? selected
        : selectWithinContext(ranked.slice(0, Math.min(config.topK, ranked.length)), config.maxContextChars);
}

function formatRagContext(chunks: DocumentChunk[], totalChunks: number, documents: SourceDocument[], skippedDocuments: SkippedDocument[]): string {
    const documentNames = documents.map(document => `doc${document.documentIndex + 1}: ${document.fileName}`);
    const skipped = skippedDocuments.map(document => `doc${document.documentIndex + 1}: ${document.fileName} (${document.reason})`);
    const formattedChunks = chunks.map(chunk => {
        const score = typeof chunk.score === "number" ? `\nscore: ${chunk.score.toFixed(3)}` : "";
        return [
            `[source: ${chunk.sourceId}]`,
            `file: ${chunk.documentName}`,
            `chunk: ${chunk.chunkIndex + 1}/${chunk.chunkCount}${score}`,
            "",
            chunk.text,
        ].join("\n");
    }).join("\n\n---\n\n");

    return [
        "",
        "Local RAG context from the user's already attached documents. If the user attached an archive, its supported files were extracted locally and listed as separate documents.",
        "Important: the user has already provided a document. Do not ask them to send the document again, and do not say that there is no document.",
        "The following are not external links or abstract sources, but extracted text from the attached document.",
        "Rules:",
        "- Answer the user's question using these fragments as the primary source.",
        "- If the user asks what the document contains, what it is about, or asks for a brief description of the document, provide a summary based on the fragments below.",
        "- If the answer is not present in the found fragments, explicitly say that it is not in the document context.",
        "- When appropriate, include fragment ids in the format [doc1-2].",
        "- If there are multiple documents, take all listed documents into account. For comparisons, clearly separate the output by document.",
        `Documents/files from archives processed: ${documents.length}. Total found: ${documents.length + skippedDocuments.length}. Selected fragments: ${chunks.length} out of ${totalChunks}.`,
        `Document names: ${documentNames.join(", ")}.`,
        skipped.length ? `Not included in RAG: ${skipped.join("; ")}.` : "",
        "",
        formattedChunks,
    ].filter(line => line.length > 0).join("\n");
}

function buildOllamaRagArtifactDetails(
    query: string,
    documents: SourceDocument[],
    selected: DocumentChunk[],
    skippedDocuments: SkippedDocument[],
    config: OllamaDocumentRagConfig,
): OllamaRagArtifactDetails {
    return {
        query,
        extractedDocuments: documents.map(document => ({
            documentIndex: document.documentIndex,
            fileName: document.fileName,
            textChars: document.text.length,
        })),
        selectedChunks: selected.map(chunk => ({
            sourceId: chunk.sourceId,
            documentIndex: chunk.documentIndex,
            documentName: chunk.documentName,
            chunkIndex: chunk.chunkIndex,
            chunkCount: chunk.chunkCount,
            textChars: chunk.text.length,
            score: chunk.score,
        })),
        skippedDocuments: skippedDocuments.map(document => ({
            documentIndex: document.documentIndex,
            fileName: document.fileName,
            reason: document.reason,
        })),
        providerState: {
            embeddingModel: config.embeddingModel,
            topK: config.topK,
            chunkSize: config.chunkSize,
            chunkOverlap: config.chunkOverlap,
            maxContextChars: config.maxContextChars,
            minScore: config.minScore,
            maxArchiveFiles: config.maxArchiveFiles,
            maxArchiveBytes: config.maxArchiveBytes,
            maxArchiveDepth: config.maxArchiveDepth,
        },
    };
}

function injectOllamaRagContext(messages: OllamaChatMessage[], context: string): void {
    const systemIndex = messages.findIndex(message => message.role === "system");

    if (systemIndex >= 0) {
        messages[systemIndex] = {
            ...messages[systemIndex],
            content: `${messages[systemIndex].content}\n\n${context}`,
        };
        return;
    }

    messages.unshift({
        role: "system",
        content: context,
    });
}

export async function buildOllamaDocumentRagContext(params: {
    downloads: AiDownloadedFile[];
    messages: OllamaChatMessage[];
    userQuery: string;
    config: OllamaDocumentRagConfig;
    onStatus?: (status: string) => Promise<void> | void;
}): Promise<{context: string; artifact: OllamaRagArtifactDetails} | null> {
    const docs = params.downloads.filter(download => download.kind === "document");
    if (!docs.length) return null;

    const setStatus = async (status: string): Promise<void> => {
        await params.onStatus?.(status);
    };

    await setStatus(Environment.getPreparingRAGText(docs.map(d => d.fileName)));

    const documents: SourceDocument[] = [];
    const skippedDocuments: SkippedDocument[] = [];
    let nextDocumentIndex = 0;

    for (const doc of docs) {
        try {
            const extracted = extractRagDocuments(doc, params.config);

            for (const document of extracted.documents) {
                if (!document.text.trim()) {
                    skippedDocuments.push({
                        documentIndex: nextDocumentIndex++,
                        fileName: document.fileName,
                        reason: `Document \`${document.fileName}\` is empty or contains no extractable text.`,
                    });
                    continue;
                }

                documents.push({
                    documentIndex: nextDocumentIndex++,
                    fileName: document.fileName,
                    text: document.text,
                });
            }

            for (const skipped of extracted.skipped) {
                skippedDocuments.push({
                    documentIndex: nextDocumentIndex++,
                    fileName: skipped.fileName,
                    reason: skipped.reason,
                });
            }
        } catch (e) {
            skippedDocuments.push({
                documentIndex: nextDocumentIndex++,
                fileName: doc.fileName,
                reason: e instanceof Error ? e.message : String(e),
            });
        }
    }

    if (!documents.length) {
        throw new Error(
            "Could not extract readable text from any document.\n" +
            skippedDocuments.map(doc => `- ${doc.fileName}: ${doc.reason}`).join("\n")
        );
    }

    const chunks = buildChunks(documents, params.config);
    if (!chunks.length) {
        throw new Error(Environment.localRagChunksBuildFailedText);
    }

    const totalContextChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    const selected = totalContextChars <= params.config.maxContextChars
        ? selectWithinContext(chunks, params.config.maxContextChars)
        : await (async () => {
            await setStatus(Environment.getBuildingRAGIndexText(params.config.embeddingModel));
            return retrieveChunks(chunks, buildRetrievalQuery(params.userQuery, params.messages), params.config);
        })();

    if (!selected.length) {
        throw new Error(Environment.localRagNoSuitableFragmentsText);
    }

    return {
        context: formatRagContext(selected, chunks.length, documents, skippedDocuments),
        artifact: buildOllamaRagArtifactDetails(buildRetrievalQuery(params.userQuery, params.messages), documents, selected, skippedDocuments, params.config),
    };
}

export async function prepareOllamaDocumentRag(params: {
    downloads: AiDownloadedFile[];
    messages: OllamaChatMessage[];
    userQuery: string;
    message: TelegramStreamMessage;
    config: OllamaDocumentRagConfig;
}): Promise<{prepared: boolean; artifact?: OllamaRagArtifactDetails}> {
    const context = await buildOllamaDocumentRagContext({
        downloads: params.downloads,
        messages: params.messages,
        userQuery: params.userQuery,
        config: params.config,
        onStatus: async status => {
            params.message.setStatus(status);
            await params.message.flush();
        },
    });

    if (!context) return {prepared: false};
    injectOllamaRagContext(params.messages, context.context);
    return {prepared: true, artifact: context.artifact};
}
