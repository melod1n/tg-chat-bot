import test from "node:test";
import assert from "node:assert/strict";

const {
    buildToolRankerSystemPrompt,
    getToolRankerAvailableToolInfos,
    sanitizeToolRankerResult,
} = await import("../dist/ai/tool-ranker-metadata.js");

function toolInfos(...toolTypes) {
    return getToolRankerAvailableToolInfos(toolTypes.map(type => ({type})));
}

function promptFor(...toolTypes) {
    return buildToolRankerSystemPrompt({
        availableTools: toolInfos(...toolTypes),
        includeExamples: true,
        maxExamplesPerTool: 1,
        compact: true,
    });
}

test("prompt contains only available tools", () => {
    const prompt = promptFor("no_tool", "get_datetime", "image_generation", "code_interpreter", "file_search");

    assert.ok(prompt.includes("no_tool"));
    assert.ok(prompt.includes("get_datetime"));
    assert.ok(prompt.includes("image_generation"));
    assert.ok(prompt.includes("code_interpreter"));
    assert.ok(prompt.includes("file_search"));
    assert.ok(!prompt.includes("get_weather"));
    assert.ok(!prompt.includes("python_interpreter"));
});

test("prompt does not contain disabled tools", () => {
    const prompt = promptFor("no_tool", "read_file", "search_files");

    assert.ok(prompt.includes("read_file"));
    assert.ok(prompt.includes("search_files"));
    assert.ok(!prompt.includes("get_weather"));
    assert.ok(!prompt.includes("shell_execute"));
    assert.ok(!prompt.includes("python_interpreter"));
});

test("examples are filtered when tools are unavailable", () => {
    const prompt = promptFor("no_tool", "read_file", "search_files");

    assert.ok(prompt.includes("прочитай src/index.ts"));
    assert.ok(prompt.includes("найди где используется sendMessage"));
    assert.ok(!prompt.includes("погода завтра"));
    assert.ok(!prompt.includes("выполни этот python код"));
});

test("prompt includes image generation routing example", () => {
    const prompt = promptFor("no_tool", "image_generation");

    assert.ok(prompt.includes("сделай его лысым"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["image_generation"]})));
});

test("prompt includes weather routing example", () => {
    const prompt = promptFor("no_tool", "get_weather");

    assert.ok(prompt.includes("погода завтра"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["get_weather"]})));
});

test("prompt includes web search routing example for current information", () => {
    const prompt = promptFor("no_tool", "web_search");

    assert.ok(prompt.includes("найди актуальную документацию OpenAI API"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["web_search"]})));
});

test("prompt includes read file routing example for known file paths", () => {
    const prompt = promptFor("no_tool", "read_file");

    assert.ok(prompt.includes("прочитай src/index.ts"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["read_file"]})));
});

test("prompt includes search files routing example for usage search", () => {
    const prompt = promptFor("no_tool", "search_files");

    assert.ok(prompt.includes("найди где используется sendMessage"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["search_files"]})));
});

test("prompt includes edit file patch routing example for targeted edits", () => {
    const prompt = promptFor("no_tool", "edit_file_patch");

    assert.ok(prompt.includes("исправь этот баг патчем"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["edit_file_patch"]})));
});

test("prompt includes update file routing example for full overwrite", () => {
    const prompt = promptFor("no_tool", "update_file");

    assert.ok(prompt.includes("полностью перезапиши config.json"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["update_file"]})));
});

test("prompt includes delete path caution for explicit deletion only", () => {
    const prompt = promptFor("no_tool", "delete_path");

    assert.ok(prompt.includes("delete_path only when the user clearly asks to delete or remove something."));
    assert.ok(prompt.includes("удали папку dist"));
    assert.ok(prompt.includes(JSON.stringify({toolNames: ["delete_path"]})));
});

test("sanitizer returns no_tool for normal explanation", () => {
    const result = sanitizeToolRankerResult({
        raw: "объясни docker volumes",
        availableToolNames: ["read_file", "search_files"],
    });

    assert.deepEqual(result, ["no_tool"]);
});

test("sanitizer removes unavailable tools", () => {
    const result = sanitizeToolRankerResult({
        raw: JSON.stringify({toolNames: ["read_file", "missing_tool"]}),
        availableToolNames: ["read_file"],
    });

    assert.deepEqual(result, ["read_file"]);
});

test("sanitizer deduplicates tools", () => {
    const result = sanitizeToolRankerResult({
        raw: JSON.stringify({toolNames: ["read_file", "read_file", "search_files"]}),
        availableToolNames: ["read_file", "search_files"],
    });

    assert.deepEqual(result, ["read_file", "search_files"]);
});

test("sanitizer handles malformed output", () => {
    const result = sanitizeToolRankerResult({
        raw: "```json\nnot json\n```",
        availableToolNames: ["read_file"],
    });

    assert.deepEqual(result, ["no_tool"]);
});

test("sanitizer removes no_tool when mixed with real tools", () => {
    const result = sanitizeToolRankerResult({
        raw: JSON.stringify({toolNames: ["no_tool", "read_file"]}),
        availableToolNames: ["read_file"],
    });

    assert.deepEqual(result, ["read_file"]);
});
