import test from "node:test";
import assert from "node:assert/strict";

const {runToolLoopRounds} = await import("../dist/ai/tool-loop-runner.js");

test("tool loop runner stops when handler requests it", async () => {
    const rounds = [];

    await runToolLoopRounds({
        maxRounds: 5,
        async onRound(round) {
            rounds.push(round);
            return {shouldContinue: round < 1};
        },
    });

    assert.deepEqual(rounds, [0, 1]);
});

test("tool loop runner calls max rounds hook when handler never stops", async () => {
    const rounds = [];
    let maxRoundsReached = -1;

    await runToolLoopRounds({
        maxRounds: 3,
        async onRound(round) {
            rounds.push(round);
            return {shouldContinue: true};
        },
        onMaxRoundsReached(round) {
            maxRoundsReached = round;
        },
    });

    assert.deepEqual(rounds, [0, 1, 2]);
    assert.equal(maxRoundsReached, 2);
});
