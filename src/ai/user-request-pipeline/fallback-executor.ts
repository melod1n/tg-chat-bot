import type {
    PipelineFallbackAction,
    PipelineFallbackPolicy,
    PipelineStageName,
    PipelineStageStatus,
} from "./types.js";

export type PipelineFallbackReason = "unavailable" | "failed";

export type PipelineFallbackDecision = {
    stage: PipelineStageName;
    reason: PipelineFallbackReason;
    action: PipelineFallbackAction;
    shouldContinue: boolean;
    shouldNotifyUser: boolean;
    shouldFailRequest: boolean;
};

const DEFAULT_ACTION_BY_REASON: Record<PipelineFallbackReason, PipelineFallbackAction> = {
    unavailable: "continue_without_stage",
    failed: "fail_request",
};

export function resolvePipelineFallbackAction(params: {
    stage: PipelineStageName;
    reason: PipelineFallbackReason;
    policies: readonly PipelineFallbackPolicy[];
}): PipelineFallbackAction {
    const policy = params.policies.find(item => item.stage === params.stage);
    if (!policy) return DEFAULT_ACTION_BY_REASON[params.reason];

    return params.reason === "unavailable"
        ? policy.onUnavailable
        : policy.onFailed;
}

export function decidePipelineFallback(params: {
    stage: PipelineStageName;
    reason: PipelineFallbackReason;
    policies: readonly PipelineFallbackPolicy[];
}): PipelineFallbackDecision {
    const action = resolvePipelineFallbackAction(params);

    return {
        stage: params.stage,
        reason: params.reason,
        action,
        shouldContinue: action === "ignore"
            || action === "continue_without_stage"
            || action === "notify_user"
            || action === "use_alternate_target",
        shouldNotifyUser: action === "notify_user",
        shouldFailRequest: action === "fail_request",
    };
}

export function fallbackReasonFromStageStatus(status: PipelineStageStatus): PipelineFallbackReason | undefined {
    if (status === "skipped") return "unavailable";
    if (status === "failed") return "failed";
    return undefined;
}
