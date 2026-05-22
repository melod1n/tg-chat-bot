import test from "node:test";
import assert from "node:assert/strict";

const {Environment} = await import("../dist/common/environment.js");

test("openai backend defaults to official", () => {
    assert.equal(Environment.OPENAI_BACKEND, "official");
});

test("openai backend setter updates runtime config", () => {
    Environment.setOpenAIBackend("compatible");
    assert.equal(Environment.OPENAI_BACKEND, "compatible");
    Environment.setOpenAIBackend("official");
});
