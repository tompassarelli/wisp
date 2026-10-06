// The frame meter (wisp:src/platform/frameMeter.ts) in 32-bit Lua: the
// fixture map (test/frameMeter/entry.ts) plays in two simulated clients, and
// the host reads what they show and write. Then runLuaPerf measures the same
// map and `wisp perf compare` holds one run against another.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { mapCompiler, report } from "../scripts/compiler";
import { FrameCosts, decodeFrameCostReport, formatFrameCost, frameCostRegressions } from "../scripts/wisp/frameCosts";
import { GameFiles } from "../scripts/wisp/gameFiles";
import { writtenPreloadFile } from "../scripts/wisp/headlessInput";
import { type PerfRun, comparePerfRuns, parsePerfRun } from "../scripts/wisp/perf";
import { type FrameWindow, frameCostFile, frameCostHeading, frameWindowLine } from "../src/runtime/frameCost";

const root = join(import.meta.dir, "..");

function play(): string[] {
  expect(report(mapCompiler(join(import.meta.dir, "tsconfig.meter-map.json"))())).toBe("");
  expect(report(mapCompiler(join(import.meta.dir, "tsconfig.meter.json"))())).toBe("");
  const run = Bun.spawnSync([
    process.env.LUA ?? "lua", join(root, "build/meter-tests/meter.lua"),
    join(root, "build/meter-tests/map.lua"), join(root, "src/natives/warcraft.d.ts"),
  ], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  return run.stdout.toString().trimEnd().split("\n");
}

const after = (lines: readonly string[], prefix: string) => lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));

test("the overlay shows to the player who asks; every client reports the frames around a reload; runs compare", async () => {
  const lines = play();
  // The player who typed -perf sees medians and maxima of the last 120 frames, including a 5-frame catch-up.
  const overlay = after(lines, "p0 overlay: ")[0] ?? "";
  expect(overlay).toMatch(/^frame cost, last 120 frames, median \/ p95 \/ max \| Lua ms: [\d.]+ \/ [\d.]+ \/ [\d.]+ \(clock step under 0\.01 ms\) \| natives: \d+ \/ \d+ \/ \d+ \| catch-up frames: 1 \/ 1 \/ 5$/);
  expect(after(lines, "p1 overlay: ")).toEqual([""]);
  expect(after(lines, "desync: ")).toEqual(["none"]);
  expect(lines.filter((line) => line.includes(" error: "))).toEqual([]);

  // Ten more calls a frame after the reload: both clients write the same frames and counts, and the host flags them.
  const reports = await Promise.all([0, 1].map((slot) =>
    Effect.runPromise(decodeFrameCostReport(`meter-perf-p${slot}.txt`, writtenPreloadFile(after(lines, `p${slot} report: `))))));
  for (const cost of reports) {
    expect({ version: cost.version, previous: cost.previous, before: cost.before.frames, after: cost.after.frames }).toEqual({ version: 1, previous: 0, before: 120, after: 120 });
    expect(cost.after.natives.median).toBeGreaterThanOrEqual(cost.before.natives.median + 8);
    expect(cost.before.catchUp).toEqual({ median: 1, mean: 1.03, max: 5 });
    expect(cost.after.catchUp).toEqual({ median: 1, mean: 1, max: 1 });
    expect(cost.before.lua?.max).toBeGreaterThan(0);
    expect(frameCostRegressions(cost).some((regression) => regression.startsWith("natives +"))).toBe(true);
  }
  expect(reports[1]?.before.natives).toEqual(reports[0]?.before.natives);
  const [first] = reports;
  if (first === undefined) throw new Error("no report");
  expect(formatFrameCost(0, first)).toMatch(/^p0 frame cost v1 vs v0 \(120 and 120 frames\): Lua [\d.]+ -> [\d.]+ ms mean \([+-]\d+%\), max [\d.]+ -> [\d.]+ ms; natives \d+ -> \d+ median \(\+\d+%\), max \d+ -> \d+; catch-up 1 -> 1 median, max 5 -> 1; REGRESSION over 20%: (Lua time \+\d+%, )?natives \+\d+%$/);
  expect(frameCostRegressions(first, 0.6).filter((regression) => regression.startsWith("natives"))).toEqual([]);

  // The measured journey: equal clients, every call counted, the same instructions in each client.
  const run = parsePerfRun(lines.slice(lines.findIndex((line) => line.startsWith("frames "))).join("\n"));
  expect({ frames: run.frames, step: run.step, problems: run.problems, slots: [...run.clients.keys()] }).toEqual({ frames: 120, step: 100, problems: 0, slots: [0, 1] });
  const [p0, p1] = [run.clients.get(0), run.clients.get(1)];
  expect(p0?.instructions).toEqual(p1?.instructions ?? {});
  expect(p0?.natives).toEqual(p1?.natives ?? {});
  // Ten calls a frame, then twenty from frame 60, besides the reloader's polls.
  expect(p0?.natives.max).toBeGreaterThanOrEqual(20);
  expect(p0?.instructions.mean).toBeGreaterThan(0);

  expect(comparePerfRuns(run, run)).toMatchObject({ regressions: [] });
  const heavier: PerfRun = {
    ...run,
    clients: new Map([...run.clients].map(([slot, values]) => [slot, { ...values, instructions: { ...values.instructions, mean: values.instructions.mean * 1.1 } }])),
  };
  expect(comparePerfRuns(run, heavier).regressions).toEqual(["p0 Lua instructions mean +10.0%", "p1 Lua instructions mean +10.0%"]);
  expect(comparePerfRuns(run, heavier, 0.2).regressions).toEqual([]);
  // What only Warcraft pays for: more allocation, which its collector sweeps, and a burst of typed text.
  const native = (change: (values: PerfRun["clients"] extends ReadonlyMap<number, infer V> ? V : never) => object): PerfRun => ({
    ...run, clients: new Map([...run.clients].map(([slot, values]) => [slot, { ...values, ...change(values) }])),
  });
  const allocating = native((values) => ({
    "alloc-kb": { ...values["alloc-kb"], mean: values["alloc-kb"].mean * 4 + 1, p95: values["alloc-kb"].p95 * 4 + 1 },
  }));
  expect(comparePerfRuns(run, allocating).regressions.filter((regression) => regression.startsWith("p0"))).toEqual([
    expect.stringMatching(/^p0 allocated KB mean /), expect.stringMatching(/^p0 allocated KB p95 /),
  ]);
  const typing = native((values) => ({ "typing-us": { ...values["typing-us"], max: 180000 } }));
  expect(comparePerfRuns(run, typing).regressions).toEqual(["p0 predicted typing stall µs max new", "p1 predicted typing stall µs max new"]);
}, 30_000);

test("the host reads each client's new report once, as the map wrote it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-frame-cost-"));
  try {
    const before: FrameWindow = { frames: 120, lua: { median: 420, mean: 436.5, max: 3100 }, natives: { median: 312, mean: 320.4, max: 498 }, catchUp: { median: 1, mean: 1.02, max: 4 } };
    const after: FrameWindow = { frames: 120, lua: undefined, natives: { median: 340, mean: 350.1, max: 520 }, catchUp: { median: 1, mean: 1, max: 1 } };
    writeFileSync(join(directory, frameCostFile(1, "meter")), writtenPreloadFile([frameCostHeading(3, 2, 977), frameWindowLine("before", before), frameWindowLine("after", after)]));
    const [first, again] = await Effect.runPromise(Effect.gen(function*() {
      const costs = yield* FrameCosts;
      return [yield* costs.changed([directory]), yield* costs.changed([directory])] as const;
    }).pipe(Effect.provide(FrameCosts.layer("meter").pipe(Layer.provide(GameFiles.layer())))));
    expect(first).toEqual([{ slot: 1, report: { version: 3, previous: 2, clockStep: 977, before, after } }]);
    expect(again).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
