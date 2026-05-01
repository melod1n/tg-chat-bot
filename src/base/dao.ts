export abstract class Dao<I, GetByIdParams, GetByIdsParams, InsertParams> {
    abstract getAll(): Promise<I[]>;

    abstract getById(params: GetByIdParams): Promise<I | null>;

    abstract getByIds(params: GetByIdsParams): Promise<I[]>;

    abstract insert(items: InsertParams): Promise<true>;
}
