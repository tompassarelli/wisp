import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./timers56/main";
import * as timer134 from "./timer134/main";
import { farmTest } from "../scripts/wisp/farmTest";

const runtime = installHeadless({ filePrefix: "timers56", globalPrefixes: ["__timers56", "__timer134"] });
afterAll(runtime.restore);

export const EXPECTED = [
  "zero-one-shot-reads-ms=0",
  "started-in-callback-fast-before=1",
  "same-deadline=second-started-first",
  "same-deadline=first-created-first",
  "fast-512th-reads-ms=500",
  "in-frame-order=earlier-deadline-first",
  "in-frame-order=later-deadline-first",
  "periodic-between-ms=250",
  "expired-after-ms=500",
  "paused-at-pause-ms=750",
  "ticks-in-one-second=60",
  "fast-in-one-second=1024",
  "fast-between-ticks=17..18",
  "zero-period-in-one-second=10002",
  "paused-later-ms=750",
  "periodic-after-ms=250",
];

test("each timer rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 76, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`timers56-p${client.slot}.txt`)).toEqual(EXPECTED);
});

farmTest("the same timer rules pass in emitted 32-bit Lua", { timeout: 120_000 }, () => {
  for (const config of ["test/timers56/tsconfig.json", "test/timers56/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/timers56/headless/headless.lua"), join(import.meta.dir, "../build/timers56/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});

// Each reading's third value is headless minus native.
const NATIVE_134_READINGS = [[1, 1092, 0], [1000, 1092254, 0], [2000, 2184504, 0], [3000, 3276754, 0], [3364, 3674332, 1], [3823, 4175675, 0], [3841, 4195335, 1], [4000, 4368963, 1]] as const;

test("[native wisp#134] a 1/60 s periodic timer fires in native's frame through callback 4,000", () => {
  let state: { count: number; chunks: string[] } | undefined;
  const clients = runtime.clients({ install: timer134.install, start: () => { timer134.start(); state = globalThis.__timer134; } }, [0], { effectStepMs: 25 });
  clients.start();
  const frames: number[] = [];
  while (frames.length < timer134.TIMER134_CALLBACKS) {
    clients.frames(1);
    while (frames.length < (state?.count ?? 0)) frames.push(clients.frame);
  }
  const readings = (state?.chunks ?? []).flatMap(chunk => chunk.split(",").filter(value => value !== "").map(Number));
  expect(NATIVE_134_FRAMES.map(([callback]) => [callback, frames[callback - 1]])).toEqual([...NATIVE_134_FRAMES]);
  expect(NATIVE_134_READINGS.map(([callback, native]) => [callback, (readings[callback - 1] ?? Number.NaN) - native])).toEqual(NATIVE_134_READINGS.map(([callback, , offset]) => [callback, offset]));
});
