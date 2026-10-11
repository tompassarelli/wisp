import { expect, test } from "bun:test";
import { uiPixels } from "../scripts/wisp/screen";

// Player 0 of four: absolute top-left (0.02625, 0.102), size 0.08, one 0.19 slot per player (wisp#125 plan).
// Two players take two slots each with the bust centred, half a slot right.
const bust = (slot: number) => [0.02625 + 0.19 * slot, 0.102, 0.02625 + 0.19 * slot + 0.08, 0.102 - 0.08] as const;

test("[reference smashcraft#363] HUD bust rectangles match native captures", () => {
  const near = (rect: ReturnType<typeof uiPixels>, x: number, y: number, size: number) => {
    for (const [actual, expected] of [[rect.x, x], [rect.y, y], [rect.width, size], [rect.height, size]] as const) expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  };
  for (const p of [0, 1]) near(uiPixels(bust(2 * p + 0.5), 800, 600), 121.25 + 380 * p, 498, 80);
  for (const p of [0, 1, 2, 3]) near(uiPixels(bust(p), 1280, 720), 191.5 + 228 * p, 597.6, 96);
});
