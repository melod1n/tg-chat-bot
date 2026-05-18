import test from "node:test";
import assert from "node:assert/strict";

const {ToolRankerFallbackPolicy} = await import("../dist/common/policies.js");
const {
    decideToolRankerFallback,
    resolveToolRankerFallbackSelection,
} = await import("../dist/ai/tool-ranker-fallback.js");

const availableToolNames = ["read_file", "search_files"];

test("tool ranker fallback returns no tools when policy is NO_TOOLS", () => {
    assert.deepEqual(
        resolveToolRankerFallbackSelection({
            fallbackPolicy: ToolRankerFallbackPolicy.NO_TOOLS,
            availableToolNames,
        }),
        {
            toolNames: [],
            usedRanker: false,
        },
    );
});

test("tool ranker fallback returns all tools when policy is ALL_TOOLS", () => {
    assert.deepEqual(
        resolveToolRankerFallbackSelection({
            fallbackPolicy: ToolRankerFallbackPolicy.ALL_TOOLS,
            availableToolNames,
        }),
        {
            toolNames: ["read_file", "search_files"],
            usedRanker: false,
        },
    );
});

test("tool ranker fallback decision uses executor semantics", () => {
    assert.deepEqual(
        decideToolRankerFallback({
            fallbackPolicy: ToolRankerFallbackPolicy.MAIN_MODEL,
            availableToolNames,
            reason: "failed",
        }),
        {
            stage: "tool_rank",
            reason: "failed",
            action: "use_alternate_target",
            shouldContinue: true,
            shouldNotifyUser: false,
            shouldFailRequest: false,
            toolNames: ["read_file", "search_files"],
            usedRanker: false,
        },
    );
});

test("tool ranker fallback keeps all tools when policy is MAIN_MODEL", () => {
    assert.deepEqual(
        resolveToolRankerFallbackSelection({
            fallbackPolicy: ToolRankerFallbackPolicy.MAIN_MODEL,
            availableToolNames,
        }),
        {
            toolNames: ["read_file", "search_files"],
            usedRanker: false,
        },
    );
});
