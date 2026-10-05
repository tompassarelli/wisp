import { assertEquals, test } from "wisp/src/runtime/testing";
import { pathPoint } from "./path";

test("path: units walk a square lap around the center, player 1 half a lap ahead", () => {
  const expected: readonly (readonly [tick: number, player: number, x: number, y: number])[] = [
    [0, 0, -512, -512],
    [16, 0, 0, -512],
    [32, 0, 512, -512],
    [80, 0, 0, 512],
    [128, 0, -512, -512],
    // The largest 32-bit tick: the lap position is taken before multiplying, so nothing wraps.
    [2147483647, 0, -512, -480],
    [0, 1, 512, 512],
  ];
  for (const [tick, player, x, y] of expected) {
    const point = pathPoint(tick, player);
    assertEquals(point.x, x, `x at tick ${tick} for player ${player}`);
    assertEquals(point.y, y, `y at tick ${tick} for player ${player}`);
  }
});
