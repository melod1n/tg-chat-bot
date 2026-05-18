import test from "node:test";
import assert from "node:assert/strict";

const {
    buildRagArtifactPayload,
} = await import("../dist/ai/rag-artifact-payload.js");
const {
    filterUserVisibleStoredAttachments,
} = await import("../dist/common/attachment-visibility.js");
const {AiProvider} = await import("../dist/model/ai-provider.js");

test("internal artifacts are not treated as user-visible attachments", () => {
    const visible = filterUserVisibleStoredAttachments([
        {
            kind: "document",
            fileId: "visible",
            fileName: "visible.txt",
            cachePath: "/tmp/visible.txt",
        },
        {
            kind: "document",
            fileId: "internal",
            fileName: "rag.json",
            cachePath: "/tmp/rag.json",
            scope: "internal_artifact",
            artifactKind: "rag",
        },
    ]);

    assert.equal(visible.length, 1);
    assert.equal(visible[0].fileId, "visible");
});

test("RAG artifact payload keeps ollama retrieval metadata", () => {
    const payload = buildRagArtifactPayload({
        provider: AiProvider.OLLAMA,
        createdAt: "2026-01-01T00:00:00.000Z",
        sources: [{
            fileId: "file-1",
            fileName: "report.txt",
            mimeType: "text/plain",
            sizeBytes: 12,
            sha256: "abc123",
            uploadedFileId: "uploaded-1",
        }],
        providerState: {
            provider: AiProvider.OLLAMA,
            prepared: true,
            embeddingModel: "nomic-embed-text:latest",
            topK: 8,
            chunkSize: 1400,
            chunkOverlap: 220,
            maxContextChars: 14000,
            extractedDocuments: [
                {documentIndex: 0, fileName: "report.txt", textChars: 120},
            ],
            selectedChunks: [
                {
                    sourceId: "doc1-1",
                    documentIndex: 0,
                    documentName: "report.txt",
                    chunkIndex: 0,
                    chunkCount: 1,
                    textChars: 120,
                    score: 0.91,
                },
            ],
            skippedDocuments: [
                {documentIndex: 1, fileName: "ignored.bin", reason: "unsupported format"},
            ],
            minScore: 0.12,
            maxArchiveFiles: 200,
            maxArchiveBytes: 50 * 1024 * 1024,
            maxArchiveDepth: 2,
            query: "What is in the file?",
        },
    });

    assert.equal(payload.artifactKind, "rag");
    assert.equal(payload.provider, AiProvider.OLLAMA);
    assert.equal(payload.sources[0].uploadedFileId, "uploaded-1");
    assert.equal(payload.providerState.provider, AiProvider.OLLAMA);
    assert.equal(payload.providerState.query, "What is in the file?");
    assert.equal(payload.providerState.selectedChunks[0].score, 0.91);
    assert.equal(payload.providerState.skippedDocuments[0].reason, "unsupported format");
    assert.equal(payload.providerState.embeddingModel, "nomic-embed-text:latest");
});
