import type {PipelineFallbackAction} from "../ai/user-request-pipeline";
import type {StoredAiRequestStatus} from "../model/stored-ai-request.js";

type CounterSnapshot = {
    total: number;
    succeeded: number;
    failed: number;
    aborted: number;
};

export type AiObservabilitySnapshot = {
    requests: CounterSnapshot;
    fallbacks: {
        total: number;
        ignore: number;
        notifyUser: number;
        continueWithoutStage: number;
        useAlternateTarget: number;
        failRequest: number;
    };
    toolCalls: number;
    ragRuns: number;
    ttsRuns: {
        total: number;
        succeeded: number;
        failed: number;
        skipped: number;
    };
};

const requestCounters = {
    total: 0,
    succeeded: 0,
    failed: 0,
    aborted: 0,
};

const fallbackCounters = {
    total: 0,
    ignore: 0,
    notifyUser: 0,
    continueWithoutStage: 0,
    useAlternateTarget: 0,
    failRequest: 0,
};

const ttsCounters = {
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
};

let toolCalls = 0;
let ragRuns = 0;

function incrementFallback(action: PipelineFallbackAction): void {
    fallbackCounters.total += 1;
    switch (action) {
        case "ignore":
            fallbackCounters.ignore += 1;
            break;
        case "notify_user":
            fallbackCounters.notifyUser += 1;
            break;
        case "continue_without_stage":
            fallbackCounters.continueWithoutStage += 1;
            break;
        case "use_alternate_target":
            fallbackCounters.useAlternateTarget += 1;
            break;
        case "fail_request":
            fallbackCounters.failRequest += 1;
            break;
    }
}

export function recordAiRequestStart(): void {
    requestCounters.total += 1;
}

export function recordAiRequestFinish(status: StoredAiRequestStatus): void {
    switch (status) {
        case "succeeded":
            requestCounters.succeeded += 1;
            break;
        case "failed":
            requestCounters.failed += 1;
            break;
        case "aborted":
            requestCounters.aborted += 1;
            break;
        case "running":
            break;
    }
}

export function recordPipelineFallback(action: PipelineFallbackAction): void {
    incrementFallback(action);
}

export function recordToolCall(): void {
    toolCalls += 1;
}

export function recordRagRun(): void {
    ragRuns += 1;
}

export function recordTtsRun(status: "succeeded" | "failed" | "skipped"): void {
    ttsCounters.total += 1;
    ttsCounters[status] += 1;
}

export function snapshotAiObservability(): AiObservabilitySnapshot {
    return {
        requests: {...requestCounters},
        fallbacks: {...fallbackCounters},
        toolCalls,
        ragRuns,
        ttsRuns: {...ttsCounters},
    };
}
