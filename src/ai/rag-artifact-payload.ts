import type {AiProvider} from "../model/ai-provider";

export type RagArtifactSource = {
    fileId: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    sha256?: string;
    uploadedFileId?: string;
    documentId?: string;
};

export type RagArtifactPayload = {
    artifactKind: "rag";
    provider: AiProvider;
    createdAt: string;
    sources: RagArtifactSource[];
    providerState:
        | {
            provider: AiProvider.OPENAI;
            vectorStoreIds: string[];
            uploadedFileIds: string[];
        }
        | {
            provider: AiProvider.MISTRAL;
            libraryId?: string;
            documentCount: number;
        }
        | {
            provider: AiProvider.OLLAMA;
            prepared: boolean;
            embeddingModel?: string;
            topK?: number;
            chunkSize?: number;
            chunkOverlap?: number;
            maxContextChars?: number;
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
            query: string;
            minScore: number;
            maxArchiveFiles: number;
            maxArchiveBytes: number;
            maxArchiveDepth: number;
        };
};

export function buildRagArtifactPayload(params: {
    provider: AiProvider;
    createdAt?: string;
    sources: RagArtifactSource[];
    providerState: RagArtifactPayload["providerState"];
}): RagArtifactPayload {
    return {
        artifactKind: "rag",
        provider: params.provider,
        createdAt: params.createdAt ?? new Date().toISOString(),
        sources: params.sources,
        providerState: params.providerState,
    };
}
