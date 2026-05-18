import test from "node:test";
import assert from "node:assert/strict";

const {PipelineFallbackNotificationRegistry} = await import("../dist/ai/user-request-pipeline/fallback-notifier-registry.js");
const {resolvePipelineFallbackText} = await import("../dist/ai/user-request-pipeline/fallback-notifier-text.js");

test("pipeline fallback text maps notify_user to a user-facing message", () => {
    assert.match(resolvePipelineFallbackText("document_rag", "notify_user"), /RAG/i);
    assert.match(resolvePipelineFallbackText("speech_to_text", "notify_user"), /transcription/i);
    assert.match(resolvePipelineFallbackText("tool_loop", "notify_user"), /tool/i);
});

test("pipeline fallback text stays silent for continue_without_stage", () => {
    assert.equal(resolvePipelineFallbackText("document_rag", "continue_without_stage"), undefined);
    assert.equal(resolvePipelineFallbackText("tool_loop", "continue_without_stage"), undefined);
});

test("pipeline fallback notification registry deduplicates one request-stage-action", () => {
    const registry = new PipelineFallbackNotificationRegistry();
    const decision = {
        stage: "tool_loop",
        action: "notify_user",
    };

    assert.equal(registry.claim("request-1", decision), true);
    assert.equal(registry.claim("request-1", decision), false);
    assert.equal(registry.claim("request-2", decision), true);
});
