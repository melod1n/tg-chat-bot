import test from "node:test";
import assert from "node:assert/strict";

const {buildStaleRagCleanupPlan} = await import("../dist/ai/rag-retention-planner.js");

test("stale rag cleanup plan selects only older rag artifacts", () => {
    const plan = buildStaleRagCleanupPlan([
        {
            id: "recent-openai",
            createdAt: "2026-05-18T00:00:00.000Z",
            payload: JSON.stringify({
                artifactKind: "rag",
                providerState: {
                    provider: "OPENAI",
                    vectorStoreIds: ["vs_1"],
                    uploadedFileIds: ["file_1"],
                },
            }),
        },
        {
            id: "stale-openai",
            createdAt: "2026-04-01T00:00:00.000Z",
            payload: JSON.stringify({
                artifactKind: "rag",
                providerState: {
                    provider: "OPENAI",
                    vectorStoreIds: ["vs_2"],
                    uploadedFileIds: ["file_2"],
                },
            }),
        },
        {
            id: "stale-ollama",
            createdAt: "2026-04-01T00:00:00.000Z",
            payload: JSON.stringify({
                artifactKind: "rag",
                providerState: {
                    provider: "OLLAMA",
                    prepared: true,
                },
            }),
        },
    ], 14, new Date("2026-05-18T00:00:00.000Z"));

    assert.equal(plan.targets.length, 1);
    assert.deepEqual(plan.targets[0], {
        artifactId: "stale-openai",
        createdAt: "2026-04-01T00:00:00.000Z",
        provider: "OPENAI",
        vectorStoreIds: ["vs_2"],
        uploadedFileIds: ["file_2"],
    });
});
