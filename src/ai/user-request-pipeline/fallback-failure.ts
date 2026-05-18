import type {PipelineFallbackDecision} from "./fallback-executor.js";

export class PipelineRequestFailure extends Error {
    constructor(public readonly decision: PipelineFallbackDecision, message: string) {
        super(message);
        this.name = "PipelineRequestFailure";
    }
}

export function raisePipelineRequestFailure(decision: PipelineFallbackDecision, stageName: string): never {
    throw new PipelineRequestFailure(decision, `Pipeline send failed at stage ${stageName} with fallback action ${decision.action}`);
}
