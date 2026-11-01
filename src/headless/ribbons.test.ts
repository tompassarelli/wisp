import { expect, test } from "bun:test";
import { MAX_RIBBON_EDGES, Ribbons } from "./ribbons";

const natives = (ribbons: Ribbons) => ribbons.behaviors() as Record<string, (...args: unknown[]) => unknown>;

test("[boundary] WispSetRibbon keeps a copy of each strip until a count of 0 removes it", () => {
  const ribbons = new Ribbons(), call = natives(ribbons);
  const points = [1, 2, 3, 4, 5, 6, 0.5, 7, 8, 9, 10, 11, 12, 1, 99, 99, 99, 99, 99, 99, 99];
  call.WispSetRibbon?.(3, points, 2, 0.25, 0.5, 1);
  call.WispSetRibbon?.(1, points, 2, 1, 1, 1);
  points[0] = -1;
  expect(ribbons.poses().map((pose) => pose.id)).toEqual([1, 3]);
  expect(ribbons.poses()[1]).toEqual({ id: 3, edges: [[1, 2, 3, 4, 5, 6, 0.5], [7, 8, 9, 10, 11, 12, 1]], color: [0.25, 0.5, 1] });
  call.WispSetRibbon?.(3, points, 0, 0, 0, 0);
  expect(ribbons.poses().map((pose) => pose.id)).toEqual([1]);
  expect(() => call.WispSetRibbon?.(2, new Array<number>((MAX_RIBBON_EDGES + 1) * 7).fill(0), MAX_RIBBON_EDGES + 1, 1, 1, 1)).toThrow();
});
