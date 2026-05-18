import {ToolRankerFallbackPolicy} from "../common/policies.js";

export type ToolRankerFallbackSelection = {
    toolNames: string[];
    usedRanker: boolean;
};

export function resolveToolRankerFallbackSelection(params: {
    fallbackPolicy: ToolRankerFallbackPolicy;
    availableToolNames: readonly string[];
}): ToolRankerFallbackSelection {
    if (params.fallbackPolicy === ToolRankerFallbackPolicy.NO_TOOLS) {
        return {
            toolNames: [],
            usedRanker: false,
        };
    }

    return {
        toolNames: [...params.availableToolNames],
        usedRanker: false,
    };
}
