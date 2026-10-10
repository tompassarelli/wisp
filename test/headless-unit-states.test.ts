import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-states/main";
import { UNIT_FIXTURE } from "./unit-states/cases";
import { farmTest } from "../scripts/wisp/farmTest";

const runtime = installHeadless({ filePrefix: "unit-states", globalPrefixes: ["__unitStates"], unitStates: UNIT_FIXTURE });
afterAll(runtime.restore);

// Native expectations follow wisp:docs/warsmash-notes.md#native-results-for-44.




export const EXPECTED = [
  "owner-retained=256",
  "facing-writes=11519",
  "life-getter-setter-agreement=4800,4800,3200,3200",
  "mana-getter-setter-agreement=1600",
  "max-life-writes=25600,25600,25600,25600",
  "max-mana-writes=20480,20480,20480,20480",
  "fractional-boundary-alive=52,1280",
  "fractional-boundary-dead=0,1280",
  "life-after-kill=0,0",
  "dead-widget-life-write=6400",
  "dead-unit-state-write=6400",
  "removal=859289472,6400",
  "death-cutoff=0,0,0",
  "death-cutoff-first-alive=106169p-18",
  "life-write-exact=15p-1,439091p-16,27p-1",
  "mana-write-exact=13107p-17,209715p-16",
  "life-after-max-change=6400",
  "dead-low-write=51",
  "dead-raised-low-write=51",
  "facing-writes-exact=11796479p-17",
  "removal-same-deadline=859289472,12800",
  "removal-next-frame=0,0",
  "removal-quarter-second=0,0",
  "removal-one-second=0,0",
];


const FRAMES = 80;

function play() {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: FRAMES, events: [] });
  return { clients, result };
}

test("[native #44] all 24 unit state rows match Warcraft in two clients", () => {
  const { clients, result } = play();
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-states-p${client.slot}.txt`)).toEqual(EXPECTED);
});

farmTest("[native #44] the same 24 unit state rows match Warcraft in emitted 32-bit Lua", () => {
  for (const config of ["test/unit-states/tsconfig.json", "test/unit-states/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/unit-states/headless/headless.lua"), join(import.meta.dir, "../build/unit-states/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});
