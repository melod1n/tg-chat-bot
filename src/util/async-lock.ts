export class AsyncSemaphore {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly maxActive: number) {
        if (!Number.isInteger(maxActive) || maxActive < 1) {
            throw new Error("AsyncSemaphore maxActive must be a positive integer.");
        }
    }

    async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }

    private async acquire(): Promise<void> {
        if (this.active < this.maxActive) {
            this.active++;
            return;
        }

        await new Promise<void>(resolve => {
            this.waiters.push(resolve);
        });
        this.active++;
    }

    private release(): void {
        this.active--;
        const next = this.waiters.shift();
        if (next) {
            next();
        }
    }
}

export class KeyedAsyncLock {
    private readonly chains = new Map<string, Promise<void>>();

    async runExclusive<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        const previous = this.chains.get(key) ?? Promise.resolve();

        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });

        const tail = previous.then(() => current, () => current);
        this.chains.set(key, tail);

        await previous.catch(() => undefined);

        try {
            return await task();
        } finally {
            release();
            if (this.chains.get(key) === tail) {
                this.chains.delete(key);
            }
        }
    }
}

export function createQueuedFunction() {
    let chain = Promise.resolve();

    return async function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
        const run = chain.then(task, task);
        chain = run.then(() => undefined, () => undefined);
        return run;
    };
}
