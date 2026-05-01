import test, {after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tg-chat-bot-rag-"));
process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? "test-token";
process.env.CREATOR_ID = process.env.CREATOR_ID ?? "1";
process.env.DATA_PATH = tempRoot;
process.env.DB_PATH = `file:${path.join(tempRoot, "test.sqlite")}`;
process.env.TEST_ENVIRONMENT = "true";

const {Environment} = await import("../dist/common/environment.js");
Environment.load();

const {DatabaseManager} = await import("../dist/db/database-manager.js");
DatabaseManager.init();
await DatabaseManager.ready;

const {ArtifactStore} = await import("../dist/common/artifact-store.js");
const {filterUserVisibleStoredAttachments} = await import("../dist/common/stored-attachment-utils.js");
const {AiProvider} = await import("../dist/model/ai-provider.js");
const {persistRagArtifactAttachment} = await import("../dist/ai/rag-artifact-store.js");

after(async () => {
    await DatabaseManager.close().catch(() => undefined);
    fs.rmSync(tempRoot, {recursive: true, force: true});
});

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

test("RAG artifacts persist structured ollama metadata", async () => {
    const chatId = 42;
    const messageId = 7;

    const attachment = await persistRagArtifactAttachment({
        provider: AiProvider.OLLAMA,
        prepared: {
            provider: AiProvider.OLLAMA,
            prepared: true,
            cleanup: async () => undefined,
            artifact: {
                query: "What is in the file?",
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
                providerState: {
                    embeddingModel: "nomic-embed-text:latest",
                    topK: 8,
                    chunkSize: 1400,
                    chunkOverlap: 220,
                    maxContextChars: 14000,
                    minScore: 0.12,
                    maxArchiveFiles: 200,
                    maxArchiveBytes: 50 * 1024 * 1024,
                    maxArchiveDepth: 2,
                },
            },
        },
        downloads: [{
            kind: "document",
            fileId: "file-1",
            fileName: "report.txt",
            buffer: Buffer.from("hello world"),
            path: path.join(tempRoot, "report.txt"),
        }],
        chatId,
        messageId,
        details: {
            embeddingModel: "nomic-embed-text:latest",
            topK: 8,
            chunkSize: 1400,
            chunkOverlap: 220,
            maxContextChars: 14000,
            artifact: {
                query: "What is in the file?",
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
                providerState: {
                    embeddingModel: "nomic-embed-text:latest",
                    topK: 8,
                    chunkSize: 1400,
                    chunkOverlap: 220,
                    maxContextChars: 14000,
                    minScore: 0.12,
                    maxArchiveFiles: 200,
                    maxArchiveBytes: 50 * 1024 * 1024,
                    maxArchiveDepth: 2,
                },
            },
        },
    });

    assert.equal(attachment?.artifactKind, "rag");
    assert.equal(fs.existsSync(attachment.cachePath), true);

    const stored = await ArtifactStore.getByMessage(chatId, messageId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].kind, "rag");
    assert.equal(stored[0].payload.providerState.query, "What is in the file?");
    assert.equal(stored[0].payload.providerState.selectedChunks[0].score, 0.91);
    assert.equal(stored[0].payload.providerState.skippedDocuments[0].reason, "unsupported format");
    assert.equal(stored[0].payload.providerState.ollama.embeddingModel, "nomic-embed-text:latest");
});
