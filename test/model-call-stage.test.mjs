import test from "node:test";
import assert from "node:assert/strict";

const {runSingleModelRequest} = await import("../dist/ai/model-call-stage.js");

test("single model request wrapper executes exactly once", async () => {
    let calls = 0;
    const result = await runSingleModelRequest({
        async execute() {
            calls += 1;
            return "ok";
        },
    });

    assert.equal(result, "ok");
    assert.equal(calls, 1);
});
