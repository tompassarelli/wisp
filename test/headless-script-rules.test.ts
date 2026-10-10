import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./script-rules50/main";
import { farmTest } from "../scripts/wisp/farmTest";

const runtime = installHeadless({ filePrefix: "script-rules", globalPrefixes: ["__scriptRules"] });
afterAll(runtime.restore);

// Native expectations follow wisp:docs/warsmash-notes.md, Script rules outside the six families.

export const EXPECTED = [
  "r2s=1.000,0.100,-1.500,123456.789,0.000",
  "r2s-ties=0.063,0.313,-0.063,0.188",
  "r2sw=     1.50,-0.063,3.0,3.0",
  "i2s=0,-7,2147483647,-2147483648",
  "r2i=1,-1,0,0",
  "s2i=12,12,-7,5,0,0,2147483647,3,12,0",
  "s2r=192,64,-288,128,0,0,384",
  "player-controllers=user,user,none,none",
  "player-slot-states=playing,playing,empty,empty",
  "frame-children=3,ScriptRulesFirst,ScriptRulesSecond,0",
  "frame-enabled-default=true",
  "frame-text-read=abc",
  "frame-text-limit-default=-256",
  "frame-text-limit-on-set=abc",
  "frame-visible-under-hidden-parent=false,false",
];
export const EXPECTED_SYNC = [
  "sync-send-returns=1,1,1,1,1,1",
  "sync-order-from-p0=Aa0,Ba0,Ab0,Bb0",
  "sync-order-from-p1=Aa1,Ba1,Ab1,Bb1",
  "sync-lengths-from-p0=200,251,252,255",
  "sync-lengths-from-p1=200,251,252,255",
  "sync-sender-mismatches=",
  "trigger-destroyed-in-own-action=12",
];

test("[native] each script rule's 3.0.1 row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 150, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => [client.errors, client.missingNatives])).toEqual([[[], []], [[], []]]);
  for (const client of clients.clients) {
    expect(client.files.get(`script-rules-p${client.slot}.txt`)).toEqual(EXPECTED);
    expect(client.files.get(`script-rules-sync-p${client.slot}.txt`)).toEqual(EXPECTED_SYNC);
  }
});

farmTest("[native] the same 3.0.1 script rule rows in emitted 32-bit Lua", () => {
  for (const config of ["test/script-rules50/tsconfig.json", "test/script-rules50/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/script-rules50/headless/headless.lua"), join(import.meta.dir, "../build/script-rules50/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => [...EXPECTED, ...EXPECTED_SYNC].map(row => `p${slot} ${row}`)));
});
