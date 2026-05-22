import test from "node:test";
import assert from "node:assert/strict";
import {OpenAI} from "openai";

const {extractOpenAiChatToolCalls} = await import("../dist/ai/provider-adapter-contract.js");

const baseURL = process.env.OPENAI_COMPATIBLE_TEST_BASE_URL;
const model = process.env.OPENAI_COMPATIBLE_TEST_MODEL;
const apiKey = process.env.OPENAI_COMPATIBLE_TEST_API_KEY ?? process.env.OPENAI_API_KEY ?? "test";

test("openai-compatible chat.completions tool loop works on a real server", {skip: !baseURL || !model}, async () => {
    const client = new OpenAI({baseURL, apiKey});

    const response = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
            {role: "system", content: "You must call the ping tool exactly once. Do not answer in plain text."},
            {role: "user", content: "ping"},
        ],
        tools: [{
            type: "function",
            function: {
                name: "ping",
                description: "Return a ping token.",
                parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
            },
        }],
        tool_choice: {
            type: "function",
            function: {name: "ping"},
        },
    });

    const calls = extractOpenAiChatToolCalls(response);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "ping");
});
