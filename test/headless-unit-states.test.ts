import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { timingTest } from "../scripts/wisp/timingTest";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-states/main";
import { UNIT_FIXTURE, UNIT_TYPE } from "./unit-states/cases";

const runtime = installHeadless({ filePrefix: "unit-states", globalPrefixes: ["__unitStates"], unitStates: UNIT_FIXTURE });
afterAll(runtime.restore);

/**
 * Warcraft 3.0.1.24342, 8 October 2026, client A, Classic graphics:
 * ~/.local/state/smashcraft/native-corpus70-20261008/unit44/unit-states-p0.txt.
 * All twenty-four rows are native observations; the first twelve also repeat clone-a's earlier run.
 */
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

/** Every row is written 1.3125 game seconds after start. */
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

timingTest("[spec #44] the unit state cases complete in two clients within two seconds", () => {
  const before = performance.now();
  play();
  const elapsed = performance.now() - before;
  expect(elapsed).toBeLessThanOrEqual(2000);
  console.info(`unit states: ${EXPECTED.length} cases, 2 clients, ${elapsed.toFixed(1)} ms`);
});

test("[invariant] an injected different life write is detected by the existing call check", () => {
  const clients = runtime.clients({ install, start: () => {
    const u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
    SetWidgetLife(u, GetPlayerId(GetLocalPlayer()) === 0 ? 50 : 51);
  } });
  const result = runJourney(clients, { frames: 1, events: [] });
  expect(result.divergence).toContain("SetWidgetLife");
});

test("[spec #44] object-data values are supplied by the declared fixture", () => {
  const clients = runtime.clients({ install, start: () => {
    const u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
    expect([GetWidgetLife(u), GetUnitState(u, UNIT_STATE_MAX_LIFE), GetUnitState(u, UNIT_STATE_MANA), GetUnitState(u, UNIT_STATE_MAX_MANA)]).toEqual([100, 100, 80, 80]);
  } });
  clients.start();
});

test("[native #44] the same 24 unit state rows match Warcraft in emitted 32-bit Lua", () => {
  for (const config of ["test/unit-states/tsconfig.json", "test/unit-states/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/unit-states/headless/headless.lua"), join(import.meta.dir, "../build/unit-states/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});
