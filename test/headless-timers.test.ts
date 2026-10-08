// wisp#56: the timer rules of wisp:docs/warsmash-notes.md#timers-and-frame-stepping,
// one row each, in Bun and in the same fixture compiled to 32-bit Lua.
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./timers56/main";
import { farmTest } from "../scripts/wisp/farmTest";

const runtime = installHeadless({ filePrefix: "timers56", globalPrefixes: ["__timers56"] });
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
