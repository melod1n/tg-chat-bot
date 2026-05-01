import test from "node:test";
import assert from "node:assert/strict";

const {UserRequestPipeline} = await import("../dist/ai/user-request-pipeline/pipeline.js");
const {splitAttachmentsBySize} = await import("../dist/ai/user-request-pipeline/size-gate.js");
const {PIPELINE_ATTACHMENT_LIMIT_BYTES} = await import("../dist/ai/user-request-pipeline/types.js");

function baseState() {
    return {
        requestId: "test-request",
        chatId: 1,
        messageId: 2,
        fromId: 3,
        receivedAt: new Date(0).toISOString(),
        text: "hello",
        settings: {
            provider: "OLLAMA",
            responseLanguage: "default",
            voiceMode: "execute",
            imageOutputMode: "photo",
        },
        inputAttachments: [],
        outputAttachments: [],
        artifacts: [],
        toolRankDecisions: [],
        audit: [],
    };
}

test("pipeline runs only requested stage slice", async () => {
    const state = baseState();
    const pipeline = new UserRequestPipeline({
        stageNames: ["input_size_gate", "download_attachments"],
        stages: [{
            name: "input_size_gate",
            async run() {
                return {
                    stage: "input_size_gate",
                    status: "succeeded",
                    details: {checked: true},
                };
            },
        }],
    });

    await pipeline.run(state, new AbortController().signal);

    assert.equal(state.audit.length, 3);
    assert.equal(state.audit[0].stage, "input_size_gate");
    assert.equal(state.audit[0].status, "running");
    assert.equal(state.audit[1].stage, "input_size_gate");
    assert.equal(state.audit[1].status, "succeeded");
    assert.deepEqual(state.audit[1].details, {checked: true});
    assert.equal(state.audit[2].stage, "download_attachments");
    assert.equal(state.audit[2].status, "skipped");
    assert.deepEqual(state.audit[2].details, {
        reason: "stage_not_registered",
        fallbackAction: "continue_without_stage",
    });
});

test("pipeline stops when fallback decision is fail_request", async () => {
    const state = baseState();
    const pipeline = new UserRequestPipeline({
        stageNames: ["send_response"],
        stages: [{
            name: "send_response",
            async run() {
                throw new Error("send failed");
            },
        }],
        fallbackPolicies: [{
            stage: "send_response",
            onUnavailable: "fail_request",
            onFailed: "fail_request",
        }],
    });

    await assert.rejects(() => pipeline.run(state, new AbortController().signal), /send failed/);
    assert.equal(state.audit.at(-1).stage, "send_response");
    assert.equal(state.audit.at(-1).status, "failed");
    assert.equal(state.audit.at(-1).details.fallbackAction, "fail_request");
});

test("pipeline continues when fallback decision allows continuation", async () => {
    const state = baseState();
    const pipeline = new UserRequestPipeline({
        stageNames: ["document_rag", "send_response"],
        stages: [
            {
                name: "document_rag",
                async run() {
                    throw new Error("rag failed");
                },
            },
            {
                name: "send_response",
                async run() {
                    return {
                        stage: "send_response",
                        status: "succeeded",
                    };
                },
            },
        ],
    });

    await pipeline.run(state, new AbortController().signal);
    assert.equal(state.audit.some(event => event.stage === "document_rag" && event.status === "failed"), true);
    assert.equal(state.audit.at(-1).stage, "send_response");
    assert.equal(state.audit.at(-1).status, "succeeded");
});

test("pipeline persists stage artifacts and direction-aware attachments", async () => {
    const state = baseState();
    const pipeline = new UserRequestPipeline({
        stageNames: ["persist_output_artifacts"],
        stages: [{
            name: "persist_output_artifacts",
            async run() {
                return {
                    stage: "persist_output_artifacts",
                    status: "succeeded",
                    artifacts: [{
                        kind: "final_text",
                        stage: "persist_output_artifacts",
                        createdAt: new Date(0).toISOString(),
                        text: "answer",
                    }],
                    attachments: [
                        {
                            direction: "input",
                            kind: "document",
                            fileName: "input.txt",
                            sizeBytes: 10,
                        },
                        {
                            direction: "output",
                            kind: "document",
                            fileName: "output.txt",
                            sizeBytes: 20,
                        },
                    ],
                };
            },
        }],
    });

    await pipeline.run(state, new AbortController().signal);

    assert.equal(state.artifacts.length, 1);
    assert.equal(state.artifacts[0].kind, "final_text");
    assert.equal(state.inputAttachments.length, 1);
    assert.equal(state.inputAttachments[0].fileName, "input.txt");
    assert.equal(state.outputAttachments.length, 1);
    assert.equal(state.outputAttachments[0].fileName, "output.txt");
});

test("size gate splits accepted and rejected attachments", () => {
    const result = splitAttachmentsBySize([
        {
            direction: "input",
            kind: "document",
            fileName: "small.txt",
            sizeBytes: PIPELINE_ATTACHMENT_LIMIT_BYTES,
        },
        {
            direction: "input",
            kind: "document",
            fileName: "large.txt",
            sizeBytes: PIPELINE_ATTACHMENT_LIMIT_BYTES + 1,
        },
    ]);

    assert.deepEqual(result.accepted.map(attachment => attachment.fileName), ["small.txt"]);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].attachment.fileName, "large.txt");
});
