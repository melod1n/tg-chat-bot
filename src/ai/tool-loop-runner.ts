export type ToolLoopRoundOutcome = {
    shouldContinue: boolean;
    maxRoundsReached?: boolean;
};

export async function runToolLoopRounds(params: {
    maxRounds: number;
    onRound: (round: number) => Promise<ToolLoopRoundOutcome>;
    onMaxRoundsReached?: (round: number) => Promise<void> | void;
}): Promise<void> {
    for (let round = 0; round < params.maxRounds; round++) {
        const outcome = await params.onRound(round);
        if (!outcome.shouldContinue) {
            if (outcome.maxRoundsReached) {
                await params.onMaxRoundsReached?.(round);
            }
            return;
        }
    }

    await params.onMaxRoundsReached?.(params.maxRounds - 1);
}
