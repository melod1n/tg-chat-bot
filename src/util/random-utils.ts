export class RandomUtils {
    static int(max: number): number {
        return Math.floor(Math.random() * Math.floor(max));
    }

    static rangedInt(from: number, to: number): number {
        return RandomUtils.int(to - from) + from;
    }

    static value<T>(list: readonly T[]): T | undefined {
        if (!list.length) return undefined;
        return list[RandomUtils.int(list.length)];
    }
}
