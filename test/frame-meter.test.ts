


import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { mapCompiler, report } from "../scripts/compiler";
import { FrameCosts, decodeFrameCostReport } from "../scripts/wisp/frameCosts";
import { GameFiles } from "../scripts/wisp/gameFiles";
import { writtenPreloadFile } from "../scripts/wisp/headlessInput";
import { PERF_METRICS, type PerfRun, comparePerfRuns, parsePerfRun } from "../scripts/wisp/perf";
import { type FrameWindow, frameCostFile, frameCostHeading, frameWindowLine } from "../src/runtime/frameCost";
import { parseFrameCostCapture } from "../scripts/wisp/frameCostCapture";
import { farmTest } from "../scripts/wisp/farmTest";

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

farmTest("[invariant] both clients measure the same frames: no desync, equal reports, natives and instructions", async () => {
  const lines = play();
  expect(after(lines, "desync: ")).toEqual(["none"]);
  expect(lines.filter((line) => line.includes(" error: "))).toEqual([]);
  const reports = await Promise.all([0, 1].map((slot) =>
    Effect.runPromise(decodeFrameCostReport(`meter-perf-p${slot}.txt`, writtenPreloadFile(after(lines, `p${slot} report: `))))));
  expect(reports[1]?.before.natives).toEqual(reports[0]?.before.natives);
  const run = parsePerfRun(lines.slice(lines.findIndex((line) => line.startsWith("frames "))).join("\n"));
  const [p0, p1] = [run.clients.get(0), run.clients.get(1)];


  const frameInstructions = (values: PerfRun["clients"] extends ReadonlyMap<number, infer V> ? V | undefined : never) => ({ ...values?.instructions, start: undefined });
  expect(frameInstructions(p0)).toEqual(frameInstructions(p1));
  expect(p0?.natives).toEqual(p1?.natives ?? {});
  expect(after(lines, "capture desync: ")).toEqual(["none"]);
}, 120_000);

test("[invariant] a written report reads back as the map wrote it, once", async () => {
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

test("[spec smashcraft#394] perf compare holds instructions at their top 1% mean: one frame's spike moves no verdict, a rise across the worst frames fails", () => {
  const run = (max: number, top: number) => parsePerfRun([
    "frames 1800 step 100 problems 0",
    ...PERF_METRICS.map((metric) => metric === "instructions"
      ? `p0 instructions start=0 total=900000 median=400 p95=700 mean=500 max=${max} top=${top}`
      : `p0 ${metric} start=0 total=0 median=0 p95=0 mean=0 max=0 top=0`),
  ].join("\n"));
  const before = run(1000, 900);
  expect(comparePerfRuns(before, run(2000, 910)).regressions).toEqual([]);
  expect(comparePerfRuns(before, run(1000, 1000)).regressions).toEqual(["p0 Lua instructions top +11.1%"]);
});
