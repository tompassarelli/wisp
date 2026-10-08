import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-motion57/main";
import { UNIT_MOTION_NOOPS, UNIT_TYPE } from "./unit-motion57/cases";

const runtime = installHeadless({ filePrefix: "unit-motion", globalPrefixes: ["__unitMotion"], intentionalNoops: UNIT_MOTION_NOOPS });
afterAll(runtime.restore);

export const EXPECTED = [
  "position-read-in-same-call=12832,-6464",
  "fly-height-rate-zero=38464",
  "facing-ex-left-right=0,23039",
  "facing-ex-normalized=34560,11520,46079,64,0",
  "facing-ex-exact-0=0",
  "facing-ex-exact-0.1=3355443p-25",
  "facing-ex-exact-1/3=5592405p-24",
  "facing-ex-exact-0.5=1p-1",
  "facing-ex-exact-1=1p0",
  "facing-ex-exact-30=7864319p-18",
  "facing-ex-exact-45=11796479p-18",
  "facing-ex-exact-57.29578=15019745p-18",
  "facing-ex-exact-60=7864319p-17",
  "facing-ex-exact-90=11796479p-17",
  "facing-ex-exact-100.25=401p-2",
  "facing-ex-exact-135=8847359p-16",
  "facing-ex-exact-179.9=11789925p-16",
  "facing-ex-exact-180=11796479p-16",
  "facing-ex-exact-180.1=11803033p-16",
  "facing-ex-exact-225=14745599p-16",
  "facing-ex-exact-270=8847359p-15",
  "facing-ex-exact-315=10321919p-15",
  "facing-ex-exact-359.9=5896601p-14",
  "facing-ex-exact-359.99=11796151p-15",
  "facing-ex-exact-360=11796479p-15",
  "facing-ex-exact-360.5=8388719p-24",
  "facing-ex-exact-450=11796485p-17",
  "facing-ex-exact-540=45p2",
  "facing-ex-exact-720=0",
  "facing-ex-exact-720.5=8389439p-24",
  "facing-ex-exact-1080=0",
  "facing-ex-exact-3600=45p-17",
  "facing-ex-exact-36000=0",
  "facing-ex-exact--0.001=11796447p-15",
  "facing-ex-exact--90=135p1",
  "facing-ex-exact--180=11796481p-16",
  "facing-ex-exact--360=15019745p-39",
  "facing-ex-exact--720=0",
  "facing-ex-exact--3600=2949117p-13",
  "facing-created-exact-0=0",
  "facing-created-exact-0.1=3355443p-25",
  "facing-created-exact-90=11796479p-17",
  "facing-created-exact-179.9=11789925p-16",
  "facing-created-exact-180=11796479p-16",
  "facing-created-exact-360=11796479p-15",
  "facing-created-exact-720.5=8389439p-24",
  "facing-created-exact--90=135p1",
  "overlapping-bodies-held=8192,4096,6400,0,8192,4096,6400,0",
  "dash-ticks-drawn-behind=26",
];

test("unit position, height, facing and dash cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 150, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-motion-p${client.slot}.txt`)).toEqual(EXPECTED);
});

test("unit coordinates and height are stored as binary32 like Warcraft's Lua numbers", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
    UnitAddAbility(u, 0x416d7266);
    UnitRemoveAbility(u, 0x416d7266);
    SetUnitX(u, third);
    SetUnitY(u, -third);
    SetUnitFlyHeight(u, third, 0);
    expect([GetUnitX(u), GetUnitY(u), GetUnitFlyHeight(u)]).toEqual([Math.fround(third), Math.fround(-third), Math.fround(third)]);
  } });
  clients.start();
});

test("the same unit motion cases pass in emitted 32-bit Lua", () => {
  for (const config of ["test/unit-motion57/tsconfig.json", "test/unit-motion57/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/unit-motion57/headless/headless.lua"), join(import.meta.dir, "../build/unit-motion57/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
}, 60_000);
