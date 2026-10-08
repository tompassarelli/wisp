import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-movement61/main";
import { UNIT_MOVEMENT_NOOPS, UNIT_TYPE } from "./unit-movement61/cases";

const runtime = installHeadless({ filePrefix: "unit-movement", globalPrefixes: ["__unitMovement"], intentionalNoops: UNIT_MOVEMENT_NOOPS });
afterAll(runtime.restore);

export const EXPECTED = [
  "fly-height-needs-crow-form=38400,38400",
  "move-speed-set-and-read=34560",
];

test("two fighter-body movement cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 5, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-movement-p${client.slot}.txt`)).toEqual(EXPECTED);
});

test("move speed is stored as binary32 like Warcraft's Lua numbers", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
    SetUnitMoveSpeed(u, 270 + third);
    expect(GetUnitMoveSpeed(u)).toBe(Math.fround(270 + third));
  } });
  clients.start();
});

test("the same unit movement cases pass in emitted 32-bit Lua", () => {
  for (const config of ["test/unit-movement61/tsconfig.json", "test/unit-movement61/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/unit-movement61/headless/headless.lua"), join(import.meta.dir, "../build/unit-movement61/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
});
