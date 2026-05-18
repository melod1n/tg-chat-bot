import test from "node:test";
import assert from "node:assert/strict";

const {runToolRankStage} = await import("../dist/ai/tool-rank-stage.js");

function createStreamMessage() {
    const events = [];
    const state = {
        status: "",
        events,
        setStatus(value) {
            state.status = value;
        },
        clearStatus() {
            state.status = "";
        },
        async flush() {},
        async storePipelineAudit(batch) {
            events.push(...batch);
        },
    };

    return state;
}

function createAuditRecorder() {
    const events = [];
    return {
        events,
        async storeAudit(params) {
            events.push({
                stage: "tool_rank",
                status: params.error ? "failed" : "succeeded",
                details: {
                    round: params.round,
                    availableTools: params.availableTools,
                    selectedTools: params.selectedTools ?? [],
                    usedRanker: params.usedRanker ?? false,
                    toolRankDecision: {
                        provider: params.provider,
                        round: params.round,
                        availableTools: params.availableTools,
                        selectedTools: params.selectedTools ?? [],
                        usedRanker: params.usedRanker ?? false,
                    },
                },
            });
        },
    };
}

test("tool rank stage clears status after success and stores decision audit", async () => {
    const streamMessage = createStreamMessage();
    const audit = createAuditRecorder();
    const result = await runToolRankStage({
        provider: "OLLAMA",
        model: "test-model",
        round: 0,
        config: {
            toolRankerFallbackPolicy: "NO_TOOLS",
        },
        availableTools: [{name: "read_file"}],
        messages: [{role: "user", content: "прочитай src/index.ts"}],
        streamMessage,
        signal: new AbortController().signal,
        storeAudit: audit.storeAudit,
        toolRanker: {
            async selectTools() {
                return {
                    toolNames: ["read_file"],
                    usedRanker: true,
                };
            },
        },
    });

    assert.deepEqual(result.selectedToolNames, ["read_file"]);
    assert.deepEqual(result.filteredTools, [{name: "read_file"}]);
    assert.equal(result.usedRanker, true);
    assert.equal(streamMessage.status, "");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].stage, "tool_rank");
    assert.equal(audit.events[0].status, "succeeded");
    assert.deepEqual(audit.events[0].details.toolRankDecision, {
        provider: "OLLAMA",
        round: 0,
        availableTools: ["read_file"],
        selectedTools: ["read_file"],
        usedRanker: true,
    });
});

test("tool rank stage clears status after failure", async () => {
    const streamMessage = createStreamMessage();
    const audit = createAuditRecorder();
    await assert.rejects(() => runToolRankStage({
        provider: "OLLAMA",
        model: "test-model",
        round: 1,
        config: {
            toolRankerFallbackPolicy: "NO_TOOLS",
        },
        availableTools: [{name: "read_file"}],
        messages: [{role: "user", content: "прочитай src/index.ts"}],
        streamMessage,
        signal: new AbortController().signal,
        storeAudit: audit.storeAudit,
        toolRanker: {
            async selectTools() {
                throw new Error("ranker failed");
            },
        },
    }), /ranker failed/);

    assert.equal(streamMessage.status, "");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].stage, "tool_rank");
    assert.equal(audit.events[0].status, "failed");
    assert.deepEqual(audit.events[0].details.toolRankDecision, {
        provider: "OLLAMA",
        round: 1,
        availableTools: ["read_file"],
        selectedTools: [],
        usedRanker: false,
    });
});
