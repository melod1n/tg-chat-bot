import type {PipelineFallbackDecision} from "./fallback-executor.js";

export function fallbackNotificationKey(requestId: string, decision: PipelineFallbackDecision): string {
    return `${requestId}:${decision.stage}:${decision.action}`;
}

export class PipelineFallbackNotificationRegistry {
    private readonly notifiedKeys = new Set<string>();

    claim(requestId: string, decision: PipelineFallbackDecision): boolean {
        const key = fallbackNotificationKey(requestId, decision);
        if (this.notifiedKeys.has(key)) return false;
        this.notifiedKeys.add(key);
        return true;
    }
}
