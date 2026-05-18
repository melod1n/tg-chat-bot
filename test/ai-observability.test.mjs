import test from "node:test";
import assert from "node:assert/strict";

const observability = await import("../dist/common/ai-observability.js");

test("ai observability snapshot counts recorded events", () => {
    const before = observability.snapshotAiObservability();

    observability.recordAiRequestStart();
    observability.recordAiRequestFinish("succeeded");
    observability.recordPipelineFallback("notify_user");
    observability.recordToolCall();
    observability.recordRagRun();
    observability.recordTtsRun("skipped");

    const after = observability.snapshotAiObservability();

    assert.equal(after.requests.total, before.requests.total + 1);
    assert.equal(after.requests.succeeded, before.requests.succeeded + 1);
    assert.equal(after.fallbacks.notifyUser, before.fallbacks.notifyUser + 1);
    assert.equal(after.toolCalls, before.toolCalls + 1);
    assert.equal(after.ragRuns, before.ragRuns + 1);
    assert.equal(after.ttsRuns.skipped, before.ttsRuns.skipped + 1);
});
