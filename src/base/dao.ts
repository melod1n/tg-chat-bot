export abstract class Dao<I> {
    abstract getAll(): Promise<I[]>;

    abstract getById(params: never): Promise<I | null>

    abstract getByIds(params: never): Promise<I[]>

    abstract insert(items: never[]): Promise<true>
}