import type {ToolCallData} from "./unified-ai-runner.shared.js";

export type ToolLoopStopReason = "no_tool_calls" | "max_rounds_reached";

export type ToolLoopContinuation = {
    continue: boolean;
    reason?: ToolLoopStopReason;
    remainingRounds: number;
};

export function decideToolLoopContinuation(params: {
    round: number;
    maxRounds: number;
    toolCalls: readonly ToolCallData[];
}): ToolLoopContinuation {
    const remainingRounds = Math.max(params.maxRounds - params.round - 1, 0);

    if (!params.toolCalls.length) {
        return {
            continue: false,
            reason: "no_tool_calls",
            remainingRounds,
        };
    }

    if (remainingRounds === 0) {
        return {
            continue: false,
            reason: "max_rounds_reached",
            remainingRounds,
        };
    }

    return {
        continue: true,
        remainingRounds,
    };
}
