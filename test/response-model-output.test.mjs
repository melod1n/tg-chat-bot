import test from "node:test";
import assert from "node:assert/strict";

const {summarizeModelOutput} = await import("../dist/ai/response-model-output.js");

test("model output summary trims text and copies attachment records", () => {
    const toolExecutions = [{toolName: "read_file", callId: "1", argumentsText: "{}", resultChars: 10}];
    const outputAttachments = [{artifactKind: "generated_file", fileName: "out.txt", sizeBytes: 12}];

    const summary = summarizeModelOutput({
        text: "  hello world  ",
        toolExecutions,
        outputAttachments,
    });

    assert.deepEqual(summary, {
        text: "hello world",
        toolExecutions,
        outputAttachments,
    });
});
