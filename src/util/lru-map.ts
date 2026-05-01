export function getLruMapValue<K, V>(map: Map<K, V>, key: K): V | undefined {
    if (!map.has(key)) return undefined;

    const value = map.get(key)!;
    map.delete(key);
    map.set(key, value);
    return value;
}

export function setLruMapValue<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
    if (maxSize < 1) {
        map.clear();
        return;
    }

    if (map.has(key)) {
        map.delete(key);
    }

    map.set(key, value);

    while (map.size > maxSize) {
        const oldestKey = map.keys().next();
        if (oldestKey.done) return;
        map.delete(oldestKey.value);
    }
}
