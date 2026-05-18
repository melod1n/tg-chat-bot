import {ToolRankerFallbackPolicy} from "../common/policies.js";
import {decidePipelineFallback, type PipelineFallbackDecision} from "./user-request-pipeline/fallback-executor.js";

export type ToolRankerFallbackSelection = {
    toolNames: string[];
    usedRanker: boolean;
};

export type ToolRankerFallbackDecision = PipelineFallbackDecision & ToolRankerFallbackSelection;

function fallbackActionForPolicy(policy: ToolRankerFallbackPolicy) {
    return policy === ToolRankerFallbackPolicy.MAIN_MODEL
        ? "use_alternate_target"
        : "continue_without_stage";
}

export function decideToolRankerFallback(params: {
    fallbackPolicy: ToolRankerFallbackPolicy;
    availableToolNames: readonly string[];
    reason: "unavailable" | "failed";
}): ToolRankerFallbackDecision {
    const action = fallbackActionForPolicy(params.fallbackPolicy);
    const decision = decidePipelineFallback({
        stage: "tool_rank",
        reason: params.reason,
        policies: [{
            stage: "tool_rank",
            onUnavailable: action,
            onFailed: action,
        }],
    });

    return {
        ...decision,
        toolNames: params.fallbackPolicy === ToolRankerFallbackPolicy.NO_TOOLS
            ? []
            : [...params.availableToolNames],
        usedRanker: false,
    };
}

export function resolveToolRankerFallbackSelection(params: {
    fallbackPolicy: ToolRankerFallbackPolicy;
    availableToolNames: readonly string[];
}): ToolRankerFallbackSelection {
    const decision = decideToolRankerFallback({
        fallbackPolicy: params.fallbackPolicy,
        availableToolNames: params.availableToolNames,
        reason: "failed",
    });

    return {
        toolNames: decision.toolNames,
        usedRanker: decision.usedRanker,
    };
}
