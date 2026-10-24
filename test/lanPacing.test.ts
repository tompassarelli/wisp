import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { pacedTurns } from "../host/lan/host";

describe("turn pacing", () => {
  test("late wakes never push a 17/17/16 cycle off its 1/60 s grid", () => {
    for (const late of [0, 1, 3, 9]) {
      let wall = 0;
      const sent: number[] = [];
      const clock = { now: () => wall, sleep: (ms: number) => Effect.sync(() => { wall += ms + late; }) };
      const turn = Effect.suspend(() => {
        sent.push(wall);
        return sent.length === 300 ? Effect.fail("enough") : Effect.void;
      });
      Effect.runSyncExit(pacedTurns([17, 17, 16], clock, turn));
      sent.forEach((at, index) => {
        const due = Math.floor((index + 1) / 3) * 50 + [0, 17, 34][(index + 1) % 3]!;
        expect(at - due).toBeGreaterThanOrEqual(0);
        expect(at - due).toBeLessThanOrEqual(late);
      });
    }
  });
});
