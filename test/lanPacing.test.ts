import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { pacedTurns } from "../host/lan/host";

describe("turn pacing", () => {
  test("each turn goes out when the wall clock reaches its summed game milliseconds at the host's speed, so late wakes and fractional speeds never drift game time", () => {
    for (const steps of [[25], [17, 17, 16], [30]]) {
      for (const speed of [1, 1.5, 3, 7, 16]) {
        for (const lateness of [0, 0.3, 0.9]) {
          const late = (lateness * Math.min(...steps)) / speed;
          let wall = 1000;
          let gameMs = 0;
          const behind: number[] = [];
          const clock = { now: () => wall, sleep: (ms: number) => Effect.sync(() => { wall += ms + late; }) };
          const turn = (step: number) => Effect.suspend(() => {
            gameMs += step;
            behind.push(wall - 1000 - gameMs / speed);
            return behind.length === 3000 ? Effect.fail("enough") : Effect.void;
          });
          Effect.runSyncExit(pacedTurns(steps, speed, clock, turn));
          expect(gameMs).toBe((3000 / steps.length) * steps.reduce((sum, step) => sum + step, 0));
          expect(Math.min(...behind)).toBeGreaterThanOrEqual(-1e-9);
          expect(Math.max(...behind)).toBeLessThanOrEqual(late + 1e-9);
          expect(Math.abs((gameMs - steps[0]!) / ((behind.at(-1)! - behind[0]! + (gameMs - steps[0]!) / speed) * speed) - 1)).toBeLessThan(1e-4);
        }
      }
    }
  });
});
