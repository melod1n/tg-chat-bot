import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {appLogger} from "../logging/logger";
import type {BoundaryValue} from "../common/boundary-types";

const logger = appLogger.child("ai-provider-queue");

export type AiRequestQueueTarget = {
    provider: AiProvider;
    model: string;
    baseUrl?: string;
};

type QueueEntry = {
    target: AiRequestQueueTarget;
    queueKey: string;
    run: () => Promise<BoundaryValue>;
    resolve: (value: BoundaryValue) => void;
    reject: (reason?: Error | string | BoundaryValue | null | undefined) => void;
    onPositionChange: (requestsBefore: number) => Promise<void> | void;
    signal?: AbortSignal;
    abortHandler?: () => void;
    started: boolean;
};

type EnqueueOptions<T extends BoundaryValue> = {
    signal?: AbortSignal;
    onPositionChange: (requestsBefore: number) => Promise<void> | void;
    run: () => Promise<T>;
};

class AiProviderRequestQueue {
    private readonly waiting = new Map<string, QueueEntry[]>();
    private readonly active = new Map<string, number>();

    enqueue<T extends BoundaryValue>(target: AiRequestQueueTarget, options: EnqueueOptions<T>): Promise<T> {
        if (options.signal?.aborted) {
            logger.debug("enqueue.rejected.aborted", {provider: target.provider, model: target.model, baseUrl: target.baseUrl});
            return Promise.reject(new Error("Aborted"));
        }

        return new Promise<T>((resolve, reject) => {
            const queueKey = this.queueKey(target);
            const entry: QueueEntry = {
                target,
                queueKey,
                run: options.run,
                resolve: value => resolve(value as T),
                reject,
                onPositionChange: options.onPositionChange,
                signal: options.signal,
                started: false,
            };

            entry.abortHandler = () => {
                if (entry.started) return;

                const removed = this.removeWaitingEntry(entry);
                if (!removed) return;

                logger.debug("entry.cancelled", {provider: target.provider, model: target.model, baseUrl: target.baseUrl, queueKey});
                reject(new Error("Aborted"));
                this.schedule(target);
            };

            options.signal?.addEventListener("abort", entry.abortHandler, {once: true});
            this.getOrCreateQueue(queueKey).push(entry);
            logger.debug("enqueue.accepted", {provider: target.provider, model: target.model, baseUrl: target.baseUrl, queued: this.getOrCreateQueue(queueKey).length, active: this.activeCount(queueKey)});
            this.schedule(target);
        });
    }

    private getQueue(queueKey: string): QueueEntry[] | undefined {
        return this.waiting.get(queueKey);
    }

    private getOrCreateQueue(queueKey: string): QueueEntry[] {
        let queue = this.waiting.get(queueKey);
        if (!queue) {
            queue = [];
            this.waiting.set(queueKey, queue);
        }
        return queue;
    }

    private activeCount(queueKey: string): number {
        return this.active.get(queueKey) ?? 0;
    }

    private setActiveCount(queueKey: string, count: number): void {
        if (count <= 0) {
            this.active.delete(queueKey);
            return;
        }
        this.active.set(queueKey, count);
    }

    private maxActive(target: AiRequestQueueTarget): number {
        return Math.max(1, Environment.getAiProviderMaxConcurrentRequests(target.provider));
    }

    private normalizeBaseUrl(baseUrl: string | undefined): string {
        return (baseUrl ?? "").trim().replace(/\/+$/, "");
    }

    private queueKey(target: AiRequestQueueTarget): string {
        return JSON.stringify([
            target.provider,
            this.normalizeBaseUrl(target.baseUrl),
            target.model.trim(),
        ]);
    }

    private removeWaitingEntry(entry: QueueEntry): boolean {
        const queue = this.getQueue(entry.queueKey);
        if (!queue) return false;

        const index = queue.indexOf(entry);
        if (index < 0) return false;

        queue.splice(index, 1);
        if (entry.abortHandler) {
            entry.signal?.removeEventListener("abort", entry.abortHandler);
        }
        this.deleteQueueIfIdle(entry.queueKey, queue);
        return true;
    }

    private schedule(target: AiRequestQueueTarget): void {
        const queueKey = this.queueKey(target);
        const queue = this.getOrCreateQueue(queueKey);

        while (queue.length && this.activeCount(queueKey) < this.maxActive(target)) {
            const entry = queue.shift();
            if (!entry) continue;

            if (entry.abortHandler) {
                entry.signal?.removeEventListener("abort", entry.abortHandler);
            }

            if (entry.signal?.aborted) {
                logger.debug("entry.skipped.aborted", {provider: target.provider, model: target.model, baseUrl: target.baseUrl, queueKey});
                entry.reject(new Error("Aborted"));
                continue;
            }

            entry.started = true;
            this.setActiveCount(queueKey, this.activeCount(queueKey) + 1);
            logger.debug("entry.started", {provider: target.provider, model: target.model, baseUrl: target.baseUrl, queued: queue.length, active: this.activeCount(queueKey)});
            void this.runEntry(entry);
        }

        this.updateWaitingMessages(target);
        if (!queue.length && this.activeCount(queueKey) <= 0) {
            this.waiting.delete(queueKey);
        }
    }

    private async runEntry(entry: QueueEntry): Promise<void> {
        try {
            entry.resolve(await entry.run());
            logger.debug("entry.done", {provider: entry.target.provider, model: entry.target.model, baseUrl: entry.target.baseUrl});
        } catch (e) {
            const error = e instanceof Error ? e : String(e);
            logger.error("entry.failed", {provider: entry.target.provider, model: entry.target.model, baseUrl: entry.target.baseUrl, error});
            entry.reject(error);
        } finally {
            this.setActiveCount(entry.queueKey, this.activeCount(entry.queueKey) - 1);
            this.schedule(entry.target);
        }
    }

    private updateWaitingMessages(target: AiRequestQueueTarget): void {
        const queueKey = this.queueKey(target);
        const active = this.activeCount(queueKey);
        const queue = [...(this.getQueue(queueKey) ?? [])];

        Promise.allSettled(queue.map((entry, index) => {
            return entry.onPositionChange(active + index);
        })).then(results => {
            for (const result of results) {
                if (result.status === "rejected") {
                    logger.error("position_update.failed", {provider: target.provider, model: target.model, reason: result.reason instanceof Error ? result.reason : String(result.reason)});
                }
            }
        }).catch(error => logger.error("position_updates.failed", {provider: target.provider, model: target.model, error: error instanceof Error ? error : String(error)}));
    }

    private deleteQueueIfIdle(queueKey: string, queue: QueueEntry[]): void {
        if (!queue.length && this.activeCount(queueKey) <= 0) {
            this.waiting.delete(queueKey);
        }
    }
}

export const aiProviderRequestQueue = new AiProviderRequestQueue();
