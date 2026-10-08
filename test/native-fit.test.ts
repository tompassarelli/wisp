// Headless prediction against the native overlay (wisp:scripts/wisp/nativeFit.ts):
// the pass rule and a fit that finds the costs a synthetic Warcraft used.
import { expect, test } from "bun:test";
import { type FrameWork, WARCRAFT_COST } from "../src/headless/nativeCost";
import { checkNative, fitNativeCost, overlayWindows, predictedOverlay } from "../scripts/wisp/nativeFit";

/** A match's frames: Lua busier every 7th, natives every 3rd, so the two can be told apart, and an allocation burst every 60th. */
const frames: FrameWork[] = Array.from({ length: 1800 }, (_, frame) => ({
  instructions: 150_000 + (frame % 7 === 0 ? 400_000 : 0) + (frame % 13) * 5_000,
  natives: 140 + (frame % 3 === 0 ? 300 : 0) + (frame % 5) * 4,
  allocatedKb: frame % 60 === 0 ? 600 : 10 + (frame % 11),
  typedCharacters: 0,
}));

test("[spec #19] a check passes only with median and p95 within 20%; readings without p95 can't pass", () => {
  const truth = { ...WARCRAFT_COST, nativeCallUs: 3, collectorUsPerKb: 4 };
  const readings = { clockStepMs: 1, windows: overlayWindows(frames.map((work) => truth.luaFactor * truth.hostUsPerThousandInstructions * work.instructions / 1000 + 3 * work.natives + 4 * work.allocatedKb), 1) };
  const exact = checkNative(truth, { name: "exact", frames, readings });
  expect(exact.passed).toBe(true);
  expect(Math.abs(exact.errors.median)).toBeLessThan(0.05);
  const slow = checkNative({ ...truth, luaFactor: truth.luaFactor * 1.5 }, { name: "slow", frames, readings });
  expect(slow.passed).toBe(false);
  const noP95 = checkNative(truth, { name: "no p95", frames, readings: { clockStepMs: 1, windows: readings.windows.map(({ median, max }) => ({ median, max })) } });
  expect(noP95.errors.p95).toBeUndefined();
  expect(noP95.passed).toBe(false);
});

test("[invariant] the fit brings the prediction to a synthetic Warcraft's readings, whatever the costs it starts from", () => {
  const truth = { ...WARCRAFT_COST, nativeCallUs: 5, collectorUsPerKb: 10 };
  const native = predictedOverlay(truth, frames, 1);
  expect(native.p95).toBeDefined();
  const readings = { clockStepMs: 1, windows: overlayWindows(frames.map((work) => truth.luaFactor * truth.hostUsPerThousandInstructions * work.instructions / 1000 + 5 * work.natives + 10 * work.allocatedKb), 1) };
  const item = { name: "synthetic", frames, readings };
  const before = checkNative(WARCRAFT_COST, item).errors;
  expect(Math.abs(before.median)).toBeGreaterThan(0.05);
  // Three summaries don't pin two costs exactly on a 1 ms clock; the fit is judged by what it predicts.
  const fitted = fitNativeCost(WARCRAFT_COST, [item]);
  const check = checkNative(fitted, item);
  expect(Math.abs(check.errors.median)).toBeLessThan(0.05);
  expect(Math.abs(check.errors.p95 ?? 1)).toBeLessThan(0.05);
  expect(Math.abs(check.errors.max)).toBeLessThan(0.1);
  expect(fitted.luaFactor).toBe(WARCRAFT_COST.luaFactor);
});
