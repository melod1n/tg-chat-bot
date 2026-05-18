import test from "node:test";
import assert from "node:assert/strict";

const {decideToolLoopContinuation} = await import("../dist/ai/tool-loop-control.js");

test("tool loop continuation stops when there are no tool calls", () => {
    const decision = decideToolLoopContinuation({
        round: 0,
        maxRounds: 3,
        toolCalls: [],
    });

    assert.equal(decision.continue, false);
    assert.equal(decision.reason, "no_tool_calls");
    assert.equal(decision.remainingRounds, 2);
});

test("tool loop continuation stops on the last allowed round", () => {
    const decision = decideToolLoopContinuation({
        round: 2,
        maxRounds: 3,
        toolCalls: [{id: "call-1", name: "read_file", argumentsText: "{}"}],
    });

    assert.equal(decision.continue, false);
    assert.equal(decision.reason, "max_rounds_reached");
    assert.equal(decision.remainingRounds, 0);
});

test("tool loop continuation allows further rounds when tools remain and rounds are left", () => {
    const decision = decideToolLoopContinuation({
        round: 1,
        maxRounds: 3,
        toolCalls: [{id: "call-1", name: "read_file", argumentsText: "{}"}],
    });

    assert.equal(decision.continue, true);
    assert.equal(decision.reason, undefined);
    assert.equal(decision.remainingRounds, 1);
});
