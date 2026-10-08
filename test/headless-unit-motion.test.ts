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
  "overlapping-bodies-held=8192,4096,6400,0,8192,4096,6400,0",
];

test("five unit position, height and facing cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 30, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-motion-p${client.slot}.txt`)).toEqual(EXPECTED);
});

test("unit coordinates, height and facing are stored as binary32 like Warcraft's Lua numbers", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
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
});
