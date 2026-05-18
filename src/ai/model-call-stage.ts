export async function runSingleModelRequest<T>(params: {
    execute: () => Promise<T>;
}): Promise<T> {
    return await params.execute();
}
