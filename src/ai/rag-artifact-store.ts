import type {StoredAttachment} from "../model/stored-attachment";
import {AiProvider} from "../model/ai-provider";
import type {AiDownloadedFile} from "./telegram-attachments";
import type {PreparedDocumentRag} from "./document-rag-pipeline";
import type {OllamaRagArtifactDetails} from "./ollama-rag";
import {persistInternalJsonArtifactAttachment} from "./internal-artifact-store";

type RagArtifactPayload = {
    artifactKind: "rag";
    provider: AiProvider;
    createdAt: string;
    sources: Array<{
        fileId: string;
        fileName: string;
        mimeType?: string;
        sizeBytes?: number;
        sha256?: string;
        uploadedFileId?: string;
        documentId?: string;
    }>;
    providerState: {
        vectorStoreIds?: string[];
        libraryId?: string;
        documentCount?: number;
        prepared?: boolean;
        uploadedFileIds?: string[];
        embeddingModel?: string;
        topK?: number;
        chunkSize?: number;
        chunkOverlap?: number;
        maxContextChars?: number;
        extractedDocuments?: Array<{
            documentIndex: number;
            fileName: string;
            textChars: number;
        }>;
        selectedChunks?: Array<{
            sourceId: string;
            documentIndex: number;
            documentName: string;
            chunkIndex: number;
            chunkCount: number;
            textChars: number;
            score?: number;
        }>;
        skippedDocuments?: Array<{
            documentIndex: number;
            fileName: string;
            reason: string;
        }>;
        query?: string;
        ollama?: OllamaRagArtifactDetails["providerState"];
    };
};

function providerState(prepared: PreparedDocumentRag, details?: NonNullable<Parameters<typeof persistRagArtifactAttachment>[0]["details"]>): RagArtifactPayload["providerState"] {
    switch (prepared.provider) {
        case AiProvider.OPENAI:
            return {
                vectorStoreIds: prepared.vectorStoreIds,
                uploadedFileIds: prepared.uploadedFileIds,
            };
        case AiProvider.MISTRAL:
            return {
                libraryId: prepared.libraryId,
                documentCount: prepared.documents.length,
            };
        case AiProvider.OLLAMA:
            return {
                prepared: prepared.prepared,
                embeddingModel: details?.embeddingModel,
                topK: details?.topK,
                chunkSize: details?.chunkSize,
                chunkOverlap: details?.chunkOverlap,
                maxContextChars: details?.maxContextChars,
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

    const payload: RagArtifactPayload = {
        artifactKind: "rag",
        provider: params.provider,
        createdAt: new Date().toISOString(),
        sources,
        providerState: {
            ...providerState(params.prepared, params.details),
            ...(params.details?.artifact ? {
                extractedDocuments: params.details.artifact.extractedDocuments,
                selectedChunks: params.details.artifact.selectedChunks,
                skippedDocuments: params.details.artifact.skippedDocuments,
                query: params.details.artifact.query,
                ollama: params.details.artifact.providerState,
            } : {}),
        },
    };
    return await persistInternalJsonArtifactAttachment({
        artifactKind: "rag",
        fileNamePrefix: "rag",
        chatId: params.chatId,
        messageId: params.messageId,
        payload,
        metadata: {
            provider: params.provider,
            sourceFileNames: sources.map(source => source.fileName),
            ...payload.providerState,
            embeddingModel: params.details?.embeddingModel,
            topK: params.details?.topK,
            chunkSize: params.details?.chunkSize,
            chunkOverlap: params.details?.chunkOverlap,
            maxContextChars: params.details?.maxContextChars,
        },
    });
}
