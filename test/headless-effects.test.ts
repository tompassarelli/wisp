import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./effects59/main";
import { EFFECT_NOOPS } from "./effects59/cases";

const runtime = installHeadless({ filePrefix: "effects", globalPrefixes: ["__effects59"], intentionalNoops: EFFECT_NOOPS });
afterAll(runtime.restore);

export const EXPECTED = [
  "created-at-point=12832,-6464,0",
  "position-read-in-same-call=96,-2592,38496",
  "axis-setters-independent=-1024,4096,576",
  "scale-zero-parked=8192,4096,-537088",
  "scale-orientation-time-keep-position=1280,2560,3840",
  "held-after-quarter-second=96,6144,12288,96,6144,12288",
];

test("six effect position cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 30, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`effects-p${client.slot}.txt`)).toEqual(EXPECTED);
});

test("effect reals are stored as binary32 like Warcraft's Lua numbers", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const e = AddSpecialEffect("x.mdx", third, -third);
    expect([BlzGetLocalSpecialEffectX(e), BlzGetLocalSpecialEffectY(e)]).toEqual([Math.fround(third), Math.fround(-third)]);
    BlzSetSpecialEffectPosition(e, third, third, -third);
    expect([BlzGetLocalSpecialEffectX(e), BlzGetLocalSpecialEffectY(e), BlzGetLocalSpecialEffectZ(e)]).toEqual([Math.fround(third), Math.fround(third), Math.fround(-third)]);
    BlzSetSpecialEffectZ(e, third * 3);
    expect(BlzGetLocalSpecialEffectZ(e)).toBe(1);
  } });
  clients.start();
  const [pose] = clients.clients[0]?.effectPoses() ?? [];
  expect(pose?.z).toBe(1);
});

test("effect scale, orientation, clock and matrix scale are stored as binary32", () => {
  const third = 1 / 3;
  const clients = runtime.clients({ install, start: () => {
    const e = AddSpecialEffect("x.mdx", 0, 0);
    BlzSetSpecialEffectScale(e, third);
    BlzSetSpecialEffectTimeScale(e, third);
    BlzSetSpecialEffectTime(e, third);
    BlzSetSpecialEffectYaw(e, third);
    BlzSetSpecialEffectPitch(e, third);
    BlzSetSpecialEffectRoll(e, third);
    BlzSetSpecialEffectMatrixScale(e, third, third, 3);
    BlzSetSpecialEffectMatrixScale(e, 3, 1, third);
  } });
  clients.start();
  const [pose] = clients.clients[0]?.effectPoses() ?? [];
  const f = Math.fround(third);
  expect(pose && [pose.scale, pose.timeScale, pose.animationElapsed, pose.yaw, pose.pitch, pose.roll]).toEqual([f, f, f, f, f, f]);
  expect(pose?.matrixScale).toEqual([Math.fround(f * 3), f, Math.fround(3 * f)]);
});

test("the same effect cases pass in emitted 32-bit Lua", () => {
  for (const config of ["test/effects59/tsconfig.json", "test/effects59/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/effects59/headless/headless.lua"), join(import.meta.dir, "../build/effects59/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)));
}, 60_000);
