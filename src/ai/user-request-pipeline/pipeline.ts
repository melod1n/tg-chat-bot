import {DEFAULT_PIPELINE_FALLBACK_POLICIES, USER_REQUEST_PIPELINE_STAGES} from "./blueprint.js";
import {decidePipelineFallback, type PipelineFallbackDecision} from "./fallback-executor.js";
import {raisePipelineRequestFailure} from "./fallback-failure.js";
import type {
    PipelineAuditEvent,
    PipelineFallbackPolicy,
    PipelineStageName,
    PipelineStageResult,
    UserRequestPipelineStage,
    UserRequestPipelineState,
} from "./types.js";

export type UserRequestPipelineOptions = {
    stages: UserRequestPipelineStage[];
    stageNames?: readonly PipelineStageName[];
    fallbackPolicies?: readonly PipelineFallbackPolicy[];
    onFallback?: (decision: PipelineFallbackDecision) => Promise<void> | void;
};

function nowIso(): string {
    return new Date().toISOString();
}

function durationMs(startedAt: number): number {
    return Date.now() - startedAt;
}

function stageEvent(event: PipelineAuditEvent): PipelineAuditEvent {
    return event;
}

export class UserRequestPipeline {
    private readonly stages = new Map<PipelineStageName, UserRequestPipelineStage>();
    private readonly stageNames: readonly PipelineStageName[];
    private readonly fallbackPolicies: readonly PipelineFallbackPolicy[];
    private readonly onFallback?: (decision: PipelineFallbackDecision) => Promise<void> | void;

    constructor(options: UserRequestPipelineOptions) {
        for (const stage of options.stages) {
            this.stages.set(stage.name, stage);
        }
        this.stageNames = options.stageNames ?? USER_REQUEST_PIPELINE_STAGES;
        this.fallbackPolicies = options.fallbackPolicies ?? DEFAULT_PIPELINE_FALLBACK_POLICIES;
        this.onFallback = options.onFallback;
    }

    async run(state: UserRequestPipelineState, signal: AbortSignal): Promise<UserRequestPipelineState> {
        for (const stageName of this.stageNames) {
            if (signal.aborted) throw new Error("Aborted");

            const stage = this.stages.get(stageName);
            if (!stage) {
                const decision = decidePipelineFallback({
                    stage: stageName,
                    reason: "unavailable",
                    policies: this.fallbackPolicies,
                });
                await this.onFallback?.(decision);
                state.audit.push(stageEvent({
                    stage: stageName,
                    status: "skipped",
                    startedAt: nowIso(),
                    finishedAt: nowIso(),
                    details: {
                        reason: "stage_not_registered",
                        fallbackAction: decision.action,
                    },
                }));
                if (decision.shouldFailRequest) {
                    raisePipelineRequestFailure(decision, stageName);
                }
                continue;
            }

            const startedAtMs = Date.now();
            const startedAt = nowIso();
            state.audit.push(stageEvent({
                stage: stageName,
                status: "running",
                startedAt,
            }));

            try {
                const result = await stage.run(state, signal);
                this.applyStageResult(state, result);
                state.audit.push(stageEvent({
                    stage: stageName,
                    status: result.status,
                    startedAt,
                    finishedAt: nowIso(),
                    durationMs: durationMs(startedAtMs),
                    details: result.fallbackAction || result.details
                        ? {
                            ...(result.details ?? {}),
                            ...(result.fallbackAction ? {fallbackAction: result.fallbackAction} : {}),
                        }
                        : undefined,
                }));
            } catch (error) {
                const decision = decidePipelineFallback({
                    stage: stageName,
                    reason: "failed",
                    policies: this.fallbackPolicies,
                });
                await this.onFallback?.(decision);
                state.audit.push(stageEvent({
                    stage: stageName,
                    status: "failed",
                    startedAt,
                    finishedAt: nowIso(),
                    durationMs: durationMs(startedAtMs),
                    details: {fallbackAction: decision.action},
                    error: error instanceof Error ? error.message : String(error),
                }));
                if (decision.shouldFailRequest) {
                    raisePipelineRequestFailure(decision, stageName);
                }
            }
        }

        return state;
    }

    private applyStageResult(state: UserRequestPipelineState, result: PipelineStageResult): void {
        if (result.artifacts?.length) {
            state.artifacts.push(...result.artifacts);
        }

        if (result.attachments?.length) {
            state.outputAttachments.push(...result.attachments.filter(attachment => attachment.direction === "output"));
            state.inputAttachments.push(...result.attachments.filter(attachment => attachment.direction === "input"));
        }
    }
}
