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
  "facing-ex-left-right=0,23040",
  "facing-ex-normalized=34560,11520,0,64,0",
  "facing-ex-exact-0=0",
  "facing-ex-exact-0.1=13421773p-27",
  "facing-ex-exact-1/3=11184811p-25",
  "facing-ex-exact-0.5=1p-1",
  "facing-ex-exact-1=1p0",
  "facing-ex-exact-30=15p1",
  "facing-ex-exact-45=45p0",
  "facing-ex-exact-57.29578=15019745p-18",
  "facing-ex-exact-60=15p2",
  "facing-ex-exact-90=45p1",
  "facing-ex-exact-100.25=401p-2",
  "facing-ex-exact-135=135p0",
  "facing-ex-exact-179.9=5894963p-15",
  "facing-ex-exact-180=45p2",
  "facing-ex-exact-180.1=5901517p-15",
  "facing-ex-exact-225=225p0",
  "facing-ex-exact-270=135p1",
  "facing-ex-exact-315=315p0",
  "facing-ex-exact-359.9=11793203p-15",
  "facing-ex-exact-359.99=1474519p-12",
  "facing-ex-exact-360=0",
  "facing-ex-exact-360.5=1p-1",
  "facing-ex-exact-450=45p1",
  "facing-ex-exact-540=45p2",
  "facing-ex-exact-720=0",
  "facing-ex-exact-720.5=1p-1",
  "facing-ex-exact-1080=0",
  "facing-ex-exact-3600=0",
  "facing-ex-exact-36000=0",
  "facing-ex-exact--0.001=11796447p-15",
  "facing-ex-exact--90=135p1",
  "facing-ex-exact--180=45p2",
  "facing-ex-exact--360=0",
  "facing-ex-exact--720=0",
  "facing-ex-exact--3600=0",
  "facing-created-exact-0=0",
  "facing-created-exact-0.1=13421773p-27",
  "facing-created-exact-90=45p1",
  "facing-created-exact-179.9=5894963p-15",
  "facing-created-exact-180=45p2",
  "facing-created-exact-360=45p3",
  "facing-created-exact-720.5=1441p-1",
  "facing-created-exact--90=-45p1",
  "overlapping-bodies-held=8192,4096,6400,0,8192,4096,6400,0",
  "dash-ticks-drawn-behind=0",
];

test("unit position, height, facing and dash cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 150, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-motion-p${client.slot}.txt`)).toEqual(EXPECTED);
});

test("unit coordinates, height and facing are stored as binary32 like Warcraft's Lua numbers", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
    UnitAddAbility(u, 0x416d7266);
    UnitRemoveAbility(u, 0x416d7266);
    SetUnitX(u, third);
    SetUnitY(u, -third);
    SetUnitFlyHeight(u, third, 0);
    BlzSetUnitFacingEx(u, third);
    expect([GetUnitX(u), GetUnitY(u), GetUnitFlyHeight(u), GetUnitFacing(u)]).toEqual([Math.fround(third), Math.fround(-third), Math.fround(third), Math.fround(third)]);
    BlzSetUnitFacingEx(u, -Math.fround(1e-10));
    expect(GetUnitFacing(u)).toBe(0);
  } });
  clients.start();
});

test("the same unit motion cases pass in emitted 32-bit Lua", () => {
  for (const config of ["test/unit-motion57/tsconfig.json", "test/unit-motion57/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/unit-motion57/headless/headless.lua"), join(import.meta.dir, "../build/unit-motion57/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
}, 60_000);
