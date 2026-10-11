import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./effects59/main";
import { DYING, EFFECT_NOOPS } from "./effects59/cases";
import { EFFECT_DEATHS, deathTimeline } from "./effects59/deaths";
import { farmTest } from "../scripts/wisp/farmTest";

const runtime = installHeadless({ filePrefix: "effects", globalPrefixes: ["__effects59"], intentionalNoops: EFFECT_NOOPS });
afterAll(runtime.restore);

export const EXPECTED = [
  "created-at-point=12832,-6464,0",
  "position-read-in-same-call=96,-2592,38496",
  "axis-setters-independent=-1024,4096,576",
  "scale-zero-parked=8192,4096,-537088",
  "scale-orientation-time-keep-position=1280,2560,3840",
  "destroyed-frozen-reads=-25600,0,0",
  "held-after-quarter-second=96,6144,12288,96,6144,12288",
];

const DEATH_TIMELINE = [0, 60, 118, 122, 299, 300, 600].flatMap(frame => {
  const drawn = frame < 300 ? "-200 death,200 death" : "";
  return [0, 1].map(slot => `p${slot} drawn@${frame}=${drawn}`);
});

test("[native #59] seven effect cases agree in two clients", () => {
  const clients = runtime.clients({ install, start }, [0, 1], { effectDeaths: EFFECT_DEATHS });
  const result = runJourney(clients, { frames: 30, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`effects-p${client.slot}.txt`)).toEqual(EXPECTED);
  // Playing and frozen destroyed effects clear after five game seconds.
  expect(deathTimeline(runtime.clients({ install, start }, [0, 1], { effectDeaths: EFFECT_DEATHS }))).toEqual(DEATH_TIMELINE);
  // A yaw, pitch, roll or orientation set after a matrix scale resets it to 1; the opposite order keeps it (#118).
  const ordered = runtime.clients({ install, start: () => {
    const scaleThenYaw = AddSpecialEffect("a.mdx", 0, 0);
    BlzSetSpecialEffectMatrixScale(scaleThenYaw, 2, 0, 3);
    BlzSetSpecialEffectYaw(scaleThenYaw, 1);
    const yawThenScale = AddSpecialEffect("b.mdx", 0, 0);
    BlzSetSpecialEffectYaw(yawThenScale, 1);
    BlzSetSpecialEffectMatrixScale(yawThenScale, 2, 0, 3);
    const scaleThenPitch = AddSpecialEffect("c.mdx", 0, 0);
    BlzSetSpecialEffectMatrixScale(scaleThenPitch, 2, 0, 3);
    BlzSetSpecialEffectPitch(scaleThenPitch, 1);
    const scaleThenRoll = AddSpecialEffect("d.mdx", 0, 0);
    BlzSetSpecialEffectMatrixScale(scaleThenRoll, 2, 0, 3);
    BlzSetSpecialEffectRoll(scaleThenRoll, 1);
    const scaleThenOrientation = AddSpecialEffect("e.mdx", 0, 0);
    BlzSetSpecialEffectMatrixScale(scaleThenOrientation, 2, 0, 3);
    BlzSetSpecialEffectOrientation(scaleThenOrientation, 1, 0, 0);
  } });
  ordered.start();
  expect((ordered.clients[0]?.effectPoses() ?? []).map(pose => [pose.model, pose.yaw, pose.matrixScale, pose.flat])).toEqual([
    ["a.mdx", 1, [1, 1, 1], false],
    ["b.mdx", 1, [2, 0, 3], true],
    ["c.mdx", 0, [1, 1, 1], false],
    ["d.mdx", 0, [1, 1, 1], false],
    ["e.mdx", 1, [1, 1, 1], false],
  ]);
});

farmTest("[native #59] the same effect cases pass in emitted 32-bit Lua", () => {
  for (const config of ["test/effects59/tsconfig.json", "test/effects59/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/effects59/headless/headless.lua"), join(import.meta.dir, "../build/effects59/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([...[0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)), ...DEATH_TIMELINE]);
}, 120_000);
