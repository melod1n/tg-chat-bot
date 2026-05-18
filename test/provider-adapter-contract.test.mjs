import test from "node:test";
import assert from "node:assert/strict";

const {
    extractOpenAiToolCalls,
    extractOpenAiStreamingToolCalls,
    extractOpenAiTextDelta,
    extractMistralToolCalls,
    extractMistralTextDelta,
    extractOllamaToolCalls,
    extractOllamaTextDelta,
} = await import("../dist/ai/provider-adapter-contract.js");

test("openai contract extracts text delta and function calls", () => {
    assert.equal(extractOpenAiTextDelta({type: "response.output_text.delta", delta: "hello"}), "hello");

    const calls = extractOpenAiToolCalls({
        output: [{
            type: "function_call",
            call_id: "call-1",
            name: "read_file",
            arguments: "{\"path\":\"src/index.ts\"}",
        }],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "call-1");
    assert.equal(calls[0].name, "read_file");

    const streamed = extractOpenAiStreamingToolCalls({
        type: "response.output_item.added",
        item: {
            type: "function_call",
            id: "call-2",
            name: "search_files",
            arguments: "{\"query\":\"sendMessage\"}",
        },
    });

    assert.equal(streamed.length, 1);
    assert.equal(streamed[0].id, "call-2");
    assert.equal(streamed[0].name, "search_files");
});

test("mistral contract extracts content and tool calls", () => {
    assert.equal(extractMistralTextDelta({
        content: [{text: "hello"}, {text: " world"}],
    }), "hello world");

    const calls = extractMistralToolCalls({
        toolCalls: [{
            id: "m-1",
            function: {
                name: "get_weather",
                arguments: {location: "Moscow"},
            },
        }],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "m-1");
    assert.equal(calls[0].name, "get_weather");
});

test("ollama contract extracts content and tool calls", () => {
    assert.equal(extractOllamaTextDelta({
        message: {content: "hello from ollama"},
    }), "hello from ollama");

    const calls = extractOllamaToolCalls({
        tool_calls: [{
            id: "o-1",
            function: {
                name: "web_search",
                arguments: {query: "openai docs"},
            },
        }],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "o-1");
    assert.equal(calls[0].name, "web_search");
});
