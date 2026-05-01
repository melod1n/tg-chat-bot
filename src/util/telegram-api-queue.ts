/**
 * Conservative Telegram Bot API promise queue.
 *
 * Defaults intentionally prefer safety over throughput:
 * - global bot limit: 30 requests / second;
 * - per-chat limit: 1 request / second;
 * - likely group/channel chats: 20 requests / minute;
 * - edit methods: 6 requests / second.
 *
 * Telegram can still return 429 for dynamic flood limits. In that case the
 * queue always honors `parameters.retry_after` and requeues the task.
 */

import {appLogger} from "../logging/logger";
import type {BoundaryValue} from "../common/boundary-types";

const logger = appLogger.child("telegram-api-queue");

export type TelegramChatId = number | string;

export type TelegramChatType = string;

export type TelegramApiTaskContext = {
    attempt: number;
    signal?: AbortSignal;
};

export type TelegramApiTask<T extends BoundaryValue> = (context: TelegramApiTaskContext) => Promise<T>;

export type RateLimitConfig = {
    maxRequests: number;
    intervalMs: number;
};

export type TelegramApiQueueTaskOptions = {
    chatId?: TelegramChatId;
    chatType?: TelegramChatType;
    method?: string;
    priority?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
    skipPerChatLimit?: boolean;
};

export type TelegramApiRetryEvent = {
    taskId: number;
    method?: string;
    chatId?: TelegramChatId;
    attempt: number;
    delayMs: number;
    reason: "telegram_retry_after" | "transient_error";
    error: Error | string | BoundaryValue | null | undefined;
};

export type TelegramApiQueueOptions = {
    globalLimit?: Partial<RateLimitConfig>;
    perChatLimit?: Partial<RateLimitConfig>;
    groupChatLimit?: Partial<RateLimitConfig>;
    editLimit?: Partial<RateLimitConfig>;
    maxConcurrent?: number;
    maxAttempts?: number;
    baseRetryDelayMs?: number;
    maxRetryDelayMs?: number;
    retryJitterMs?: number;
    retryAfterSafetyMs?: number;
    maxQueueSize?: number;
    onRetry?: (event: TelegramApiRetryEvent) => void;
};

export type TelegramApiQueueStats = {
    queued: number;
    running: number;
    closed: boolean;
};

type RetryDecision = {
    delayMs: number;
    reason: TelegramApiRetryEvent["reason"];
};

type QueueEntryState = "queued" | "running" | "settled" | "cancelled";

type QueueEntry<T extends BoundaryValue = BoundaryValue> = {
    id: number;
    sequence: number;
    task: TelegramApiTask<T>;
    options: TelegramApiQueueTaskOptions;
    attempt: number;
    notBefore: number;
    state: QueueEntryState;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: Error | string | BoundaryValue | null | undefined) => void;
    abortHandler?: () => void;
};

type ResolvedTelegramApiQueueOptions = {
    globalLimit: RateLimitConfig;
    perChatLimit: RateLimitConfig;
    groupChatLimit: RateLimitConfig;
    editLimit: RateLimitConfig;
    maxConcurrent: number;
    maxAttempts: number;
    baseRetryDelayMs: number;
    maxRetryDelayMs: number;
    retryJitterMs: number;
    retryAfterSafetyMs: number;
    maxQueueSize: number;
    onRetry?: (event: TelegramApiRetryEvent) => void;
};

const DEFAULT_OPTIONS: ResolvedTelegramApiQueueOptions = {
    globalLimit: {maxRequests: 30, intervalMs: 1000},
    perChatLimit: {maxRequests: 1, intervalMs: 1000},
    groupChatLimit: {maxRequests: 20, intervalMs: 60_000},
    editLimit: {maxRequests: 6, intervalMs: 1000},
    maxConcurrent: 8,
    maxAttempts: 5,
    baseRetryDelayMs: 500,
    maxRetryDelayMs: 30_000,
    retryJitterMs: 250,
    retryAfterSafetyMs: 250,
    maxQueueSize: 10_000,
};

function mergeLimitConfig(base: RateLimitConfig, override?: Partial<RateLimitConfig>): RateLimitConfig {
    return {
        maxRequests: override?.maxRequests ?? base.maxRequests,
        intervalMs: override?.intervalMs ?? base.intervalMs,
    };
}

function resolveOptions(options: TelegramApiQueueOptions): ResolvedTelegramApiQueueOptions {
    return {
        globalLimit: mergeLimitConfig(DEFAULT_OPTIONS.globalLimit, options.globalLimit),
        perChatLimit: mergeLimitConfig(DEFAULT_OPTIONS.perChatLimit, options.perChatLimit),
        groupChatLimit: mergeLimitConfig(DEFAULT_OPTIONS.groupChatLimit, options.groupChatLimit),
        editLimit: mergeLimitConfig(DEFAULT_OPTIONS.editLimit, options.editLimit),
        maxConcurrent: options.maxConcurrent ?? DEFAULT_OPTIONS.maxConcurrent,
        maxAttempts: options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
        baseRetryDelayMs: options.baseRetryDelayMs ?? DEFAULT_OPTIONS.baseRetryDelayMs,
        maxRetryDelayMs: options.maxRetryDelayMs ?? DEFAULT_OPTIONS.maxRetryDelayMs,
        retryJitterMs: options.retryJitterMs ?? DEFAULT_OPTIONS.retryJitterMs,
        retryAfterSafetyMs: options.retryAfterSafetyMs ?? DEFAULT_OPTIONS.retryAfterSafetyMs,
        maxQueueSize: options.maxQueueSize ?? DEFAULT_OPTIONS.maxQueueSize,
        onRetry: options.onRetry,
    };
}

function createAbortError(): Error {
    const error = new Error("Telegram API queue task aborted");
    error.name = "AbortError";
    return error;
}

function createClosedError(): Error {
    return new Error("Telegram API queue is closed");
}

function createQueueOverflowError(maxQueueSize: number): Error {
    return new Error(`Telegram API queue overflow: maxQueueSize=${maxQueueSize}`);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRecord(value: BoundaryValue): value is Record<string, BoundaryValue> {
    return typeof value === "object" && value !== null;
}

function readPath(source: BoundaryValue, pathParts: readonly string[]): BoundaryValue {
    let current = source;
    for (const part of pathParts) {
        if (!isRecord(current)) return undefined;
        current = current[part];
    }
    return current;
}

function readNumber(source: BoundaryValue, paths: readonly (readonly string[])[]): number | undefined {
    for (const pathParts of paths) {
        const value = readPath(source, pathParts);
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
}

function readString(source: BoundaryValue, paths: readonly (readonly string[])[]): string | undefined {
    for (const pathParts of paths) {
        const value = readPath(source, pathParts);
        if (typeof value === "string") return value;
    }
    return undefined;
}

function extractRetryAfterMs(error: BoundaryValue, safetyMs: number): number | undefined {
    const retryAfterSeconds = readNumber(error, [
        ["parameters", "retry_after"],
        ["response", "parameters", "retry_after"],
        ["response", "body", "parameters", "retry_after"],
        ["body", "parameters", "retry_after"],
    ]);

    if (retryAfterSeconds === undefined) return undefined;
    return Math.max(0, Math.ceil(retryAfterSeconds * 1000) + safetyMs);
}

function extractStatusCode(error: BoundaryValue): number | undefined {
    return readNumber(error, [
        ["error_code"],
        ["errorCode"],
        ["status"],
        ["statusCode"],
        ["response", "error_code"],
        ["response", "status"],
        ["response", "statusCode"],
        ["response", "body", "error_code"],
        ["body", "error_code"],
    ]);
}

function extractErrorCode(error: BoundaryValue): string | undefined {
    return readString(error, [
        ["code"],
        ["errno"],
        ["cause", "code"],
    ]);
}

function extractErrorMessage(error: BoundaryValue): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    const message = readString(error, [
        ["message"],
        ["description"],
        ["response", "description"],
        ["response", "body", "description"],
        ["body", "description"],
    ]);
    return message ?? "";
}

function isTelegramTooManyRequests(error: BoundaryValue): boolean {
    return extractStatusCode(error) === 429 || /too many requests|retry after/i.test(extractErrorMessage(error));
}

function isTransientError(error: BoundaryValue): boolean {
    const statusCode = extractStatusCode(error);
    if (statusCode !== undefined) {
        if (statusCode === 408) return true;
        if (statusCode >= 500 && statusCode <= 599) return true;
        if (statusCode >= 400 && statusCode <= 499) return false;
    }

    const code = extractErrorCode(error);
    if (code && ["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EAI_AGAIN", "ENOTFOUND", "EPIPE"].includes(code)) {
        return true;
    }

    return /timeout|socket hang up|network error|econnreset|econnaborted|eai_again/i.test(extractErrorMessage(error));
}

function isLikelyGroupChatId(chatId: TelegramChatId | undefined): boolean {
    if (typeof chatId === "number") return chatId < 0;
    if (typeof chatId === "string") return chatId.startsWith("-");
    return false;
}

function isGroupLikeChat(chatType: TelegramChatType | undefined, chatId: TelegramChatId | undefined): boolean {
    if (chatType === "group" || chatType === "supergroup" || chatType === "channel") return true;
    if (chatType === "private") return false;
    return isLikelyGroupChatId(chatId);
}

function isEditMethod(method: string | undefined): boolean {
    return !!method && method.toLowerCase().startsWith("edit");
}

function normalizeBucketKey(value: TelegramChatId): string {
    return String(value);
}

class SlidingWindowRateLimit {
    private timestamps: number[] = [];
    private pausedUntil = 0;
    private lastTouched = Date.now();

    constructor(private readonly config: RateLimitConfig) {
    }

    nextDelay(now: number): number {
        this.lastTouched = now;
        this.prune(now);

        const pauseDelay = Math.max(0, this.pausedUntil - now);
        if (pauseDelay > 0) return pauseDelay;
        if (this.timestamps.length < this.config.maxRequests) return 0;

        const oldest = this.timestamps[0] ?? now;
        return Math.max(0, oldest + this.config.intervalMs - now);
    }

    record(now: number): void {
        this.lastTouched = now;
        this.prune(now);
        this.timestamps.push(now);
    }

    pause(delayMs: number, now: number): void {
        this.lastTouched = now;
        this.pausedUntil = Math.max(this.pausedUntil, now + delayMs);
    }

    isIdle(now: number, idleMs: number): boolean {
        this.prune(now);
        return this.timestamps.length === 0
            && this.pausedUntil <= now
            && now - this.lastTouched >= idleMs;
    }

    private prune(now: number): void {
        const minTime = now - this.config.intervalMs;
        while (this.timestamps.length && (this.timestamps[0] ?? now) <= minTime) {
            this.timestamps.shift();
        }
    }
}

export class TelegramApiQueue {
    private readonly options: ResolvedTelegramApiQueueOptions;
    private readonly globalBucket: SlidingWindowRateLimit;
    private readonly editBucket: SlidingWindowRateLimit;
    private readonly chatBuckets = new Map<string, SlidingWindowRateLimit>();
    private readonly groupChatBuckets = new Map<string, SlidingWindowRateLimit>();
    private readonly idleResolvers: Array<() => void> = [];
    private readonly bucketIdleMs: number;
    private queue: Array<QueueEntry<BoundaryValue>> = [];
    private timer: NodeJS.Timeout | null = null;
    private running = 0;
    private nextId = 1;
    private nextSequence = 1;
    private closed = false;

    constructor(options: TelegramApiQueueOptions = {}) {
        this.options = resolveOptions(options);
        this.globalBucket = new SlidingWindowRateLimit(this.options.globalLimit);
        this.editBucket = new SlidingWindowRateLimit(this.options.editLimit);
        this.bucketIdleMs = Math.max(this.options.perChatLimit.intervalMs, this.options.groupChatLimit.intervalMs) * 2;
        logger.debug("created", {maxConcurrent: this.options.maxConcurrent, maxAttempts: this.options.maxAttempts, maxQueueSize: this.options.maxQueueSize});
    }

    get stats(): TelegramApiQueueStats {
        return {
            queued: this.queue.length,
            running: this.running,
            closed: this.closed,
        };
    }

    enqueue<T extends BoundaryValue>(task: TelegramApiTask<T>, options: TelegramApiQueueTaskOptions = {}): Promise<T> {
        if (this.closed) {
            logger.warn("enqueue.rejected.closed", {method: options.method, chatId: options.chatId});
            return Promise.reject(createClosedError());
        }
        if (this.queue.length >= this.options.maxQueueSize) {
            logger.error("enqueue.rejected.overflow", {method: options.method, chatId: options.chatId, queued: this.queue.length, maxQueueSize: this.options.maxQueueSize});
            return Promise.reject(createQueueOverflowError(this.options.maxQueueSize));
        }
        if (options.signal?.aborted) {
            logger.debug("enqueue.rejected.aborted", {method: options.method, chatId: options.chatId});
            return Promise.reject(createAbortError());
        }

        return new Promise<T>((resolve, reject) => {
            const entry: QueueEntry<BoundaryValue> = {
                id: this.nextId++,
                sequence: this.nextSequence++,
                task,
                options,
                attempt: 1,
                notBefore: Date.now(),
                state: "queued",
                resolve: (value: BoundaryValue) => resolve(value as T),
                reject,
            };

            this.attachAbortHandler(entry);

            this.insertEntry(entry);
            logger.trace("enqueue.accepted", {taskId: entry.id, method: options.method, chatId: options.chatId, priority: options.priority, queued: this.queue.length, running: this.running});
            this.pump();
        });
    }

    waitUntilIdle(): Promise<void> {
        if (this.queue.length === 0 && this.running === 0) return Promise.resolve();

        return new Promise(resolve => {
            this.idleResolvers.push(resolve);
        });
    }

    close(reason: Error | string | BoundaryValue | null | undefined = createClosedError()): void {
        this.closed = true;
        logger.warn("closed", {queued: this.queue.length, running: this.running, reason});
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        const queued = this.queue;
        logger.debug("close.cancel_queued", {queued: queued.length});
        this.queue = [];
        for (const entry of queued) {
            this.cleanupAbortHandler(entry);
            entry.state = "cancelled";
            entry.reject(reason);
        }
        this.chatBuckets.clear();
        this.groupChatBuckets.clear();
        this.resolveIdleIfNeeded();
    }

    clear(reason: Error | string | BoundaryValue | null | undefined = new Error("Telegram API queue was cleared")): void {
        const queued = this.queue;
        logger.warn("cleared", {queued: queued.length, running: this.running, reason});
        this.queue = [];
        for (const entry of queued) {
            this.cleanupAbortHandler(entry);
            entry.state = "cancelled";
            entry.reject(reason);
        }
        this.resolveIdleIfNeeded();
    }

    private insertEntry(entry: QueueEntry<BoundaryValue>): void {
        this.queue.push(entry);
        this.queue.sort((left, right) => {
            const priorityDiff = (right.options.priority ?? 0) - (left.options.priority ?? 0);
            return priorityDiff || left.sequence - right.sequence;
        });
    }

    private abortQueuedEntry(taskId: number): void {
        const index = this.queue.findIndex(entry => entry.id === taskId);
        if (index < 0) return;

        const entry = this.queue.splice(index, 1)[0];
        if (!entry) return;

        this.cleanupAbortHandler(entry);
        entry.state = "cancelled";
        logger.debug("entry.cancelled", {taskId: entry.id, method: entry.options.method, chatId: entry.options.chatId});
        entry.reject(createAbortError());
        this.resolveIdleIfNeeded();
    }

    private pump(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.closed) return;
        this.cleanupIdleBuckets();

        while (this.running < this.options.maxConcurrent) {
            const selection = this.selectNextEntry(Date.now());
            if (!selection) {
                this.resolveIdleIfNeeded();
                return;
            }

            if (selection.delayMs > 0) {
                logger.trace("pump.delayed", {delayMs: selection.delayMs, queued: this.queue.length, running: this.running});
                this.schedule(selection.delayMs);
                return;
            }

            const entry = this.queue.splice(selection.index, 1)[0];
            if (!entry) continue;
            this.startEntry(entry);
        }
    }

    private selectNextEntry(now: number): { index: number; delayMs: number } | null {
        let bestBlockedIndex = -1;
        let bestBlockedDelay = Number.POSITIVE_INFINITY;

        for (let index = 0; index < this.queue.length; index++) {
            const entry = this.queue[index];
            if (!entry) continue;

            if (entry.options.signal?.aborted) {
                this.abortQueuedEntry(entry.id);
                index--;
                continue;
            }

            const delayMs = this.nextDelayFor(entry, now);
            if (delayMs === 0) return {index, delayMs};
            if (delayMs < bestBlockedDelay) {
                bestBlockedDelay = delayMs;
                bestBlockedIndex = index;
            }
        }

        if (bestBlockedIndex < 0) return null;
        return {index: bestBlockedIndex, delayMs: bestBlockedDelay};
    }

    private startEntry(entry: QueueEntry<BoundaryValue>): void {
        entry.state = "running";
        this.cleanupAbortHandler(entry);
        this.recordStart(entry, Date.now());
        this.running++;
        logger.trace("entry.started", {taskId: entry.id, method: entry.options.method, chatId: entry.options.chatId, attempt: entry.attempt, queued: this.queue.length, running: this.running});
        void this.runEntry(entry);
    }

    private async runEntry(entry: QueueEntry<BoundaryValue>): Promise<void> {
        try {
            if (entry.options.signal?.aborted) throw createAbortError();

            const result = await entry.task({
                attempt: entry.attempt,
                signal: entry.options.signal,
            });
            entry.state = "settled";
            logger.trace("entry.settled", {taskId: entry.id, method: entry.options.method, chatId: entry.options.chatId, attempt: entry.attempt});
            entry.resolve(result);
        } catch (error) {
            const errorValue = error instanceof Error ? error : String(error);
            const retry = this.getRetryDecision(errorValue, entry);
            if (retry && !this.closed) {
                this.applyRetryPause(entry, retry);
                entry.attempt++;
                entry.notBefore = Date.now() + retry.delayMs;
                entry.state = "queued";
                if (entry.options.signal?.aborted) {
                    entry.state = "cancelled";
                    entry.reject(createAbortError());
                } else {
                    this.attachAbortHandler(entry);
                    this.insertEntry(entry);
                    logger.warn("entry.retry", {taskId: entry.id, method: entry.options.method, chatId: entry.options.chatId, attempt: entry.attempt - 1, delayMs: retry.delayMs, reason: retry.reason, error: errorValue});
                    this.options.onRetry?.({
                        taskId: entry.id,
                        method: entry.options.method,
                        chatId: entry.options.chatId,
                        attempt: entry.attempt - 1,
                        delayMs: retry.delayMs,
                        reason: retry.reason,
                        error: errorValue,
                    });
                }
            } else {
                entry.state = "settled";
                logger.error("entry.failed", {taskId: entry.id, method: entry.options.method, chatId: entry.options.chatId, attempt: entry.attempt, error: errorValue});
                entry.reject(this.closed ? createClosedError() : errorValue);
            }
        } finally {
            this.running--;
            this.pump();
        }
    }

    private nextDelayFor(entry: QueueEntry<BoundaryValue>, now: number): number {
        const explicitDelay = Math.max(0, entry.notBefore - now);
        const bucketDelay = this.bucketsFor(entry).reduce((maxDelay, bucket) => {
            return Math.max(maxDelay, bucket.nextDelay(now));
        }, 0);

        return Math.max(explicitDelay, bucketDelay);
    }

    private recordStart(entry: QueueEntry<BoundaryValue>, now: number): void {
        for (const bucket of this.bucketsFor(entry)) {
            bucket.record(now);
        }
    }

    private bucketsFor(entry: QueueEntry<BoundaryValue>): SlidingWindowRateLimit[] {
        const buckets = [this.globalBucket];
        const chatId = entry.options.chatId;

        if (chatId !== undefined && !entry.options.skipPerChatLimit) {
            buckets.push(this.getChatBucket(chatId));
            if (isGroupLikeChat(entry.options.chatType, chatId)) {
                buckets.push(this.getGroupChatBucket(chatId));
            }
        }

        if (isEditMethod(entry.options.method)) {
            buckets.push(this.editBucket);
        }

        return buckets;
    }

    private getChatBucket(chatId: TelegramChatId): SlidingWindowRateLimit {
        const key = normalizeBucketKey(chatId);
        let bucket = this.chatBuckets.get(key);
        if (!bucket) {
            bucket = new SlidingWindowRateLimit(this.options.perChatLimit);
            this.chatBuckets.set(key, bucket);
        }
        return bucket;
    }

    private getGroupChatBucket(chatId: TelegramChatId): SlidingWindowRateLimit {
        const key = normalizeBucketKey(chatId);
        let bucket = this.groupChatBuckets.get(key);
        if (!bucket) {
            bucket = new SlidingWindowRateLimit(this.options.groupChatLimit);
            this.groupChatBuckets.set(key, bucket);
        }
        return bucket;
    }

    private getRetryDecision(error: Error | string | BoundaryValue | null | undefined, entry: QueueEntry<BoundaryValue>): RetryDecision | null {
        if (entry.options.signal?.aborted) return null;

        const maxAttempts = entry.options.maxAttempts ?? this.options.maxAttempts;
        if (entry.attempt >= maxAttempts) return null;

        const retryAfterMs = extractRetryAfterMs(error, this.options.retryAfterSafetyMs);
        if (retryAfterMs !== undefined || isTelegramTooManyRequests(error)) {
            return {
                delayMs: retryAfterMs ?? this.backoffDelay(entry.attempt),
                reason: "telegram_retry_after",
            };
        }

        if (!isTransientError(error)) return null;

        return {
            delayMs: this.backoffDelay(entry.attempt),
            reason: "transient_error",
        };
    }

    private backoffDelay(attempt: number): number {
        const exponential = this.options.baseRetryDelayMs * (2 ** Math.max(0, attempt - 1));
        const capped = Math.min(this.options.maxRetryDelayMs, exponential);
        const jitter = this.options.retryJitterMs > 0 ? Math.floor(Math.random() * this.options.retryJitterMs) : 0;
        return capped + jitter;
    }

    private applyRetryPause(entry: QueueEntry<BoundaryValue>, retry: RetryDecision): void {
        if (retry.reason !== "telegram_retry_after") return;

        const now = Date.now();
        for (const bucket of this.bucketsFor(entry)) {
            bucket.pause(retry.delayMs, now);
        }
    }

    private schedule(delayMs: number): void {
        const safeDelay = Math.max(0, Math.min(delayMs, 2_147_483_647));
        this.timer = setTimeout(() => {
            this.timer = null;
            this.pump();
        }, safeDelay);
    }

    private attachAbortHandler<T extends BoundaryValue>(entry: QueueEntry<T>): void {
        if (!entry.options.signal || entry.abortHandler) return;
        entry.abortHandler = () => this.abortQueuedEntry(entry.id);
        entry.options.signal.addEventListener("abort", entry.abortHandler, {once: true});
    }

    private cleanupAbortHandler<T extends BoundaryValue>(entry: QueueEntry<T>): void {
        if (!entry.abortHandler) return;
        entry.options.signal?.removeEventListener("abort", entry.abortHandler);
        entry.abortHandler = undefined;
    }

    private resolveIdleIfNeeded(): void {
        if (this.queue.length !== 0 || this.running !== 0) return;

        this.cleanupIdleBuckets();
        const resolvers = this.idleResolvers.splice(0);
        for (const resolve of resolvers) {
            resolve();
        }
    }

    private cleanupIdleBuckets(now = Date.now()): void {
        for (const [key, bucket] of this.chatBuckets) {
            if (bucket.isIdle(now, this.bucketIdleMs)) {
                this.chatBuckets.delete(key);
            }
        }

        for (const [key, bucket] of this.groupChatBuckets) {
            if (bucket.isIdle(now, this.bucketIdleMs)) {
                this.groupChatBuckets.delete(key);
            }
        }
    }
}

export const telegramApiQueue = new TelegramApiQueue();

export async function enqueueTelegramApi<T extends BoundaryValue>(
    task: TelegramApiTask<T>,
    options?: TelegramApiQueueTaskOptions
): Promise<T> {
    return telegramApiQueue.enqueue(task, options);
}

export async function enqueueTelegramApiCall<T extends BoundaryValue>(
    task: () => Promise<T>,
    options?: TelegramApiQueueTaskOptions
): Promise<T> {
    return telegramApiQueue.enqueue(() => task(), options);
}

export async function sleepForTelegramRetry(ms: number): Promise<void> {
    await delay(ms);
}
