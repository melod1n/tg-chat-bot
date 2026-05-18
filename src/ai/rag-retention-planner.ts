import type {RagArtifactPayload} from "./rag-artifact-payload";

export type ArtifactLike = {
    id: string;
    createdAt: string;
    payload: string;
};

export type RagCleanupTarget = {
    artifactId: string;
    createdAt: string;
    provider: RagArtifactPayload["providerState"]["provider"];
    vectorStoreIds?: string[];
    uploadedFileIds?: string[];
    libraryId?: string;
};

export type RagCleanupPlan = {
    cutoffAt: string;
    targets: RagCleanupTarget[];
};

function parseRagArtifactPayload(payload: string): RagArtifactPayload | null {
    try {
        const parsed = JSON.parse(payload) as Partial<RagArtifactPayload>;
        if (!parsed || parsed.artifactKind !== "rag" || !parsed.providerState) return null;
        return parsed as RagArtifactPayload;
    } catch {
        return null;
    }
}

export function buildStaleRagCleanupPlan(
    artifacts: ArtifactLike[],
    retentionDays = 14,
    now = new Date(),
): RagCleanupPlan {
    const cutoffAt = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const targets: RagCleanupTarget[] = [];

    for (const artifact of artifacts) {
        if (artifact.createdAt > cutoffAt) continue;

        const payload = parseRagArtifactPayload(artifact.payload);
        if (!payload || payload.artifactKind !== "rag") continue;

        switch (payload.providerState.provider) {
            case "OPENAI":
                if (payload.providerState.vectorStoreIds.length || payload.providerState.uploadedFileIds.length) {
                    targets.push({
                        artifactId: artifact.id,
                        createdAt: artifact.createdAt,
                        provider: payload.providerState.provider,
                        vectorStoreIds: [...payload.providerState.vectorStoreIds],
                        uploadedFileIds: [...payload.providerState.uploadedFileIds],
                    });
                }
                break;
            case "MISTRAL":
                if (payload.providerState.libraryId) {
                    targets.push({
                        artifactId: artifact.id,
                        createdAt: artifact.createdAt,
                        provider: payload.providerState.provider,
                        libraryId: payload.providerState.libraryId,
                    });
                }
                break;
            case "OLLAMA":
                break;
        }
    }

    return {cutoffAt, targets};
}
