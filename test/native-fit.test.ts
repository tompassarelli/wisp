// Headless prediction against the native overlay (wisp:scripts/wisp/nativeFit.ts):
// readings in either format, frames replayed through the overlay's windows,
// the pass rule, and a fit that finds the costs a synthetic Warcraft used.
import { expect, test } from "bun:test";
import { type FrameWork, WARCRAFT_COST } from "../src/headless/nativeCost";
import { checkNative, fitNativeCost, overlayWindows, parseNativeReadings, parsePerfSamples, predictedOverlay, summarizeWindows } from "../scripts/wisp/nativeFit";

/** A match's frames: Lua busier every 7th, natives every 3rd, so the two can be told apart, and an allocation burst every 60th. */
const frames: FrameWork[] = Array.from({ length: 1800 }, (_, frame) => ({
  instructions: 150_000 + (frame % 7 === 0 ? 400_000 : 0) + (frame % 13) * 5_000,
  natives: 140 + (frame % 3 === 0 ? 300 : 0) + (frame % 5) * 4,
  allocatedKb: frame % 60 === 0 ? 600 : 10 + (frame % 11),
  typedCharacters: 0,
}));

test("readings come as plain windows or as a bot session's result", () => {
  expect(parseNativeReadings(JSON.stringify({ clockStepMs: 1.1, windows: [{ median: 4, max: 30 }, { median: 5, p95: 12, max: 40 }] })))
    .toEqual({ clockStepMs: 1.1, windows: [{ median: 4, max: 30 }, { median: 5, p95: 12, max: 40 }] });
  const session = { frame_cost_overlay: { readings: 2, windows: [{ epoch: 3, lua_ms: { median: 5, p95: 14, max: 48 }, natives: { median: 155 } }] } };
  expect(parseNativeReadings(JSON.stringify(session))).toEqual({ clockStepMs: 0.97656, windows: [{ median: 5, p95: 14, max: 48 }] });
  expect(() => parseNativeReadings("{}")).toThrow("no overlay windows");
});

test("perf --samples lines become each client's frames", () => {
  const text = "frames 2 step 100 problems 0\nframe 1 p0 instructions=1200 lua-us=20 natives=3 alloc-bytes=2048 typed=0\nframe 1 p1 instructions=900 lua-us=15 natives=2 alloc-bytes=0 typed=5\nframe 2 p0 instructions=100 lua-us=2 natives=1 alloc-bytes=512 typed=0\n";
  const bySlot = parsePerfSamples(text);
  expect(bySlot.get(0)).toEqual([{ instructions: 1200, natives: 3, allocatedKb: 2, typedCharacters: 0 }, { instructions: 100, natives: 1, allocatedKb: 0.5, typedCharacters: 0 }]);
  expect(bySlot.get(1)?.[0]?.typedCharacters).toBe(5);
});

test("frames are read as the overlay reads them: whole clock steps, 120-frame windows every 30 frames", () => {
  const windows = overlayWindows(Array.from({ length: 240 }, () => 2500), 1);
  expect(windows.length).toBe(5);
  // 2.5 ms on a 1 ms clock reads as 2 or 3, each about half the time; the windows' median sits between.
  for (const window of windows) {
    expect([2, 2.5, 3]).toContain(window.median);
    expect(window.max).toBe(3);
  }
  expect(summarizeWindows([{ median: 4, p95: 9, max: 30 }, { median: 6, p95: 11, max: 50 }, { median: 5, p95: 10, max: 40 }])).toEqual({ median: 5, p95: 10, max: 40, windows: 3 });
});

test("a check passes only with median and p95 within 20%; readings without p95 can't pass", () => {
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

test("the fit brings the prediction to a synthetic Warcraft's readings, whatever the costs it starts from", () => {
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
