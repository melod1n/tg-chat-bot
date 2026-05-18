import type {StoredAttachment} from "../model/stored-attachment";
import {AiProvider} from "../model/ai-provider";
import type {AiDownloadedFile} from "./telegram-attachments";
import type {PreparedDocumentRag} from "./document-rag-pipeline";
import type {OllamaRagArtifactDetails} from "./ollama-rag";
import {persistInternalJsonArtifactAttachment} from "./internal-artifact-store";
import {buildRagArtifactPayload, type RagArtifactPayload} from "./rag-artifact-payload";

function providerState(prepared: PreparedDocumentRag, details?: NonNullable<Parameters<typeof persistRagArtifactAttachment>[0]["details"]>): RagArtifactPayload["providerState"] {
    switch (prepared.provider) {
        case AiProvider.OPENAI:
            return {
                provider: AiProvider.OPENAI,
                vectorStoreIds: prepared.vectorStoreIds,
                uploadedFileIds: prepared.uploadedFileIds,
            };
        case AiProvider.MISTRAL:
            return {
                provider: AiProvider.MISTRAL,
                libraryId: prepared.libraryId,
                documentCount: prepared.documents.length,
            };
        case AiProvider.OLLAMA:
            return {
                provider: AiProvider.OLLAMA,
                prepared: prepared.prepared,
                embeddingModel: details?.embeddingModel,
                topK: details?.topK,
                chunkSize: details?.chunkSize,
                chunkOverlap: details?.chunkOverlap,
                maxContextChars: details?.maxContextChars,
                extractedDocuments: details?.artifact?.extractedDocuments ?? [],
                selectedChunks: details?.artifact?.selectedChunks ?? [],
                skippedDocuments: details?.artifact?.skippedDocuments ?? [],
                query: details?.artifact?.query ?? "",
                minScore: details?.artifact?.providerState?.minScore ?? 0,
                maxArchiveFiles: details?.artifact?.providerState?.maxArchiveFiles ?? 0,
                maxArchiveBytes: details?.artifact?.providerState?.maxArchiveBytes ?? 0,
                maxArchiveDepth: details?.artifact?.providerState?.maxArchiveDepth ?? 0,
            };
    }
}

export async function persistRagArtifactAttachment(params: {
    provider: AiProvider;
    prepared: PreparedDocumentRag | undefined;
    downloads: AiDownloadedFile[];
    chatId: number;
    messageId: number;
    details?: {
        uploadedFileIds?: string[];
        sourceDocuments?: Array<{
            fileId: string;
            fileName: string;
            mimeType?: string;
            sizeBytes?: number;
            sha256?: string;
            uploadedFileId?: string;
            documentId?: string;
        }>;
        embeddingModel?: string;
        topK?: number;
        chunkSize?: number;
        chunkOverlap?: number;
        maxContextChars?: number;
        artifact?: OllamaRagArtifactDetails;
    };
}): Promise<StoredAttachment | undefined> {
    if (!params.prepared) return Promise.resolve(undefined);

    const sources = params.downloads
        .filter(download => download.kind === "document")
        .map((download, index) => ({
            fileId: download.fileId,
            fileName: download.fileName,
            mimeType: download.mimeType,
            sizeBytes: download.sizeBytes ?? download.buffer.length,
            sha256: download.sha256,
            uploadedFileId: params.details?.uploadedFileIds?.[index],
        }));

    if (!sources.length) return Promise.resolve(undefined);

    const payload = buildRagArtifactPayload({
        provider: params.provider,
        sources,
        providerState: providerState(params.prepared, params.details),
    });
    return await persistInternalJsonArtifactAttachment({
        artifactKind: "rag",
        fileNamePrefix: "rag",
        chatId: params.chatId,
        messageId: params.messageId,
        payload,
        metadata: {
            sourceFileNames: sources.map(source => source.fileName),
            ...payload.providerState,
        },
    });
}
