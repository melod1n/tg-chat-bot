import test from "node:test";
import assert from "node:assert/strict";

const {summarizeToolLoop} = await import("../dist/ai/tool-loop-summary.js");

test("tool loop summary skips empty tool execution batches", () => {
    const summary = summarizeToolLoop({
        text: "answer",
        executions: [],
        outputAttachments: [],
    });

    assert.equal(summary.status, "skipped");
    assert.equal(summary.fallbackAction, "continue_without_stage");
    assert.equal(summary.details.count, 0);
    assert.deepEqual(summary.details.tools, []);
    assert.deepEqual(summary.details.modelOutput, {
        text: "answer",
        toolExecutions: [],
        outputAttachments: [],
    });
    assert.equal(summary.artifacts, undefined);
});

test("tool loop summary reports executions and summary artifact", () => {
    const summary = summarizeToolLoop({
        text: "answer",
        executions: [{
            toolName: "read_file",
            callId: "call-1",
            argumentsText: "{}",
            resultChars: 12,
        }],
        outputAttachments: [],
    });

    assert.equal(summary.status, "succeeded");
    assert.equal(summary.fallbackAction, undefined);
    assert.equal(summary.details.count, 1);
    assert.deepEqual(summary.details.tools, [{
        toolName: "read_file",
        callId: "call-1",
        resultChars: 12,
    }]);
    assert.equal(summary.artifacts?.[0]?.kind, "tool_result");
    assert.equal(summary.artifacts?.[0]?.stage, "tool_loop");
});
