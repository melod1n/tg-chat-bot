import test from "node:test";
import assert from "node:assert/strict";

const {
    DEFAULT_PIPELINE_FALLBACK_POLICIES,
} = await import("../dist/ai/user-request-pipeline/blueprint.js");
const {
    decidePipelineFallback,
    fallbackReasonFromStageStatus,
    resolvePipelineFallbackAction,
} = await import("../dist/ai/user-request-pipeline/fallback-executor.js");

test("fallback executor resolves configured failed action", () => {
    assert.equal(
        resolvePipelineFallbackAction({
            stage: "input_size_gate",
            reason: "failed",
            policies: DEFAULT_PIPELINE_FALLBACK_POLICIES,
        }),
        "notify_user",
    );
});

test("fallback executor uses default action for missing policy", () => {
    assert.equal(
        resolvePipelineFallbackAction({
            stage: "send_response",
            reason: "failed",
            policies: [],
        }),
        "fail_request",
    );
    assert.equal(
        resolvePipelineFallbackAction({
            stage: "send_response",
            reason: "unavailable",
            policies: [],
        }),
        "continue_without_stage",
    );
});

test("fallback decision exposes notify and continuation flags", () => {
    const decision = decidePipelineFallback({
        stage: "document_rag",
        reason: "failed",
        policies: DEFAULT_PIPELINE_FALLBACK_POLICIES,
    });

    assert.equal(decision.action, "notify_user");
    assert.equal(decision.shouldNotifyUser, true);
    assert.equal(decision.shouldContinue, true);
    assert.equal(decision.shouldFailRequest, false);
});

test("fallback reason maps only failed and skipped statuses", () => {
    assert.equal(fallbackReasonFromStageStatus("failed"), "failed");
    assert.equal(fallbackReasonFromStageStatus("skipped"), "unavailable");
    assert.equal(fallbackReasonFromStageStatus("succeeded"), undefined);
});
