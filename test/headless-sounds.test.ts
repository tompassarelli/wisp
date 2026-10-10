

import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./sounds60/main";
import { SOUND_NATIVES } from "./sounds60/cases";
import { farmTest } from "../scripts/wisp/farmTest";
import * as audio80 from "./audio80/main";

const runtime = installHeadless({ filePrefix: "sounds60", globalPrefixes: ["__sounds60"], natives: SOUND_NATIVES });
afterAll(runtime.restore);


export const EXPECTED = [
  "pitch-two-at-0.25=true",
  "kill-when-done-at-0.5=false",
  "stopped-kill-when-done-restarted=false",
  "same-file-playing=0/12",
  "pitch-two-at-0.75=false",
  "fade-stopped-loop-at-1=false",
  "start-while-playing-at-1.25=false",
  "stop-then-start-at-1.25=true",
  "released-handle-started=false",
  "fade-stopped-loop-restarted=true",
];

test("each sound rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 240, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`sounds60-p${client.slot}.txt`)).toEqual(EXPECTED);
});

farmTest("the same sound rules pass in emitted 32-bit Lua", { timeout: 120_000 }, () => {
  for (const config of ["test/sounds60/tsconfig.json", "test/sounds60/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/sounds60/headless/headless.lua"), join(import.meta.dir, "../build/sounds60/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});
