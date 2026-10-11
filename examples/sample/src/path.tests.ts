import { assertEquals, test } from "wisp/src/runtime/testing";
import { floorMod } from "wisp/src/sim/intMath";
import { type Offset, pathPoint } from "./path";

const same = (actual: Offset, expected: Offset, message: string) => {
  assertEquals(actual.x, expected.x, `${message} x`);
  assertEquals(actual.y, expected.y, `${message} y`);
};

test("[property seed 7] path: units walk a square lap around the center, 32 a tick counterclockwise, player 1 half a lap ahead", () => {
  let seed = 7;
  const next = (below: number) => {
    seed = floorMod(seed * 75 + 74, 65537);
    return floorMod(seed, below);
  };
  same(pathPoint(0, 0), { x: -512, y: -512 }, "start");
  for (let run = 0; run < 400; run++) {
    // Ticks across the 32-bit range, the first one the largest: the lap position is taken before multiplying, so nothing wraps.
    const tick = run === 0 ? 2147483647 : 128 + next(65536) * 32767 + next(32767);
    const player = next(2);
    const point = pathPoint(tick, player);
    const at = `tick ${tick} player ${player}`;
    assertEquals(Math.max(Math.abs(point.x), Math.abs(point.y)), 512, `${at} on the square`);
    const previous = pathPoint(tick - 1, player);
    assertEquals(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y), 32, `${at} step`);
    assertEquals(previous.x * point.y - previous.y * point.x, 512 * 32, `${at} counterclockwise`);
    same(pathPoint(tick - 128, player), point, `${at} lap`);
    same(pathPoint(tick - 64, player + 1), point, `${at} half a lap ahead`);
  }
});
