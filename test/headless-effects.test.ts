import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./effects59/main";
import { DYING, EFFECT_NOOPS } from "./effects59/cases";
import { EFFECT_DEATHS, deathTimeline } from "./effects59/deaths";
import { deathSeconds } from "../scripts/wisp/models";
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
});

test("[reference] effect positions, scale, orientation, clock and matrix scale are stored as binary32 like Warcraft's Lua numbers", () => {
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
  {
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
  }
});

test("[native #59] playing and frozen destroyed effects clear after five game seconds", () => {
  const clients = runtime.clients({ install, start }, [0, 1], { effectDeaths: EFFECT_DEATHS });
  expect(deathTimeline(clients)).toEqual(DEATH_TIMELINE);
  expect(clients.firstDivergence()).toBeUndefined();
  for (const client of clients.clients) expect(client.files.get(`effects-p${client.slot}.txt`)).toEqual(EXPECTED);
  expect(deathTimeline(runtime.clients({ install, start }))[0]).toBe("p0 drawn@0=-200 stand,200 stand");
});

test("[native #59] the map can't change a destroyed effect, but reads where it stands until decay", () => {
  const clients = runtime.clients({ install, start: () => {
    const e = AddSpecialEffect(DYING, 10, 20);
    DestroyEffect(e);
    BlzSetSpecialEffectPosition(e, 1, 2, 3);
    BlzSetSpecialEffectTimeScale(e, 0);
    BlzPlaySpecialEffect(e, ANIM_TYPE_STAND);
    expect([BlzGetLocalSpecialEffectX(e), BlzGetLocalSpecialEffectY(e), BlzGetLocalSpecialEffectZ(e)]).toEqual([10, 20, 0]);
    DestroyEffect(e);
    BlzRemoveEffect(e);
  } }, [0, 1], { effectDeaths: EFFECT_DEATHS });
  clients.start();
  clients.frames(119);
  expect(clients.clients[0]?.effectPoses().map(pose => [pose.x, pose.y, pose.timeScale, pose.animation, pose.death])).toEqual([[10, 20, 1, "death", 2]]);
  clients.frames(181);
  expect(clients.clients[0]?.effectPoses()).toEqual([]);
});

test("[reference] Death length comes from the model file's first death sequence", () => {
  const model = (sequences: string) => new TextEncoder().encode(`Version { FormatVersion 800, }\nModel "Fixture" { BlendTime 150, }\nSequences ${sequences.split("Anim").length - 1} {\n${sequences}}\n`);
  expect(deathSeconds(model(`Anim "Stand" { Interval { 0, 1000 }, }\nAnim "Death" { Interval { 1500, 3500 }, NonLooping, }\n`))).toBe(2);
  expect(deathSeconds(model(`Anim "Birth" { Interval { 0, 800 }, NonLooping, }\n`))).toBeUndefined();
});

farmTest("[native #59] the same effect cases pass in emitted 32-bit Lua", () => {
  for (const config of ["test/effects59/tsconfig.json", "test/effects59/tsconfig.headless.json"]) expect(report(mapCompiler(join(import.meta.dir, "..", config))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/effects59/headless/headless.lua"), join(import.meta.dir, "../build/effects59/map.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split("\n")).toEqual([...[0, 1].flatMap(slot => EXPECTED.map(row => `p${slot} ${row}`)), ...DEATH_TIMELINE]);
}, 120_000);

// Native reads: Warcraft III 3.0.0.24268, offline LAN pool client lan1b, Classic, 9 Oct 2026; ForkedLightningTarget's
// Birth clock (interval 833-1767 ms) read from memory: 933 inside the spawn callback (its 0.1 s seek), 833 after that step,
// then +25 per 25 ms step; frozen at +0, +1, +2 and +3 callbacks after the spawn it read 833, 833, 858 and 858 (wisp#72).
test("[native #72] 3.0.0 LAN effect clocks advance 25 ms per engine step, and a selection's step restarts without advancing", () => {
  const read = (held: number | undefined) => {
    let e: effect | undefined;
    const clients = runtime.clients({ install, start: () => { e = AddSpecialEffect(DYING, 10, 20); } }, [0], { effectStepMs: 25 });
    clients.start();
    clients.frames(30 - clients.clients[0]!.frame);
    const client = clients.clients[0]!;
    const elapsed = () => Math.round(client.effectPoses()[0]!.animationElapsed * 1000);
    const seen: number[] = [];
    client.run(() => { BlzSetSpecialEffectAnimation(e!, "birth"); BlzSetSpecialEffectTime(e!, 0.1); if (held === 0) BlzSetSpecialEffectTimeScale(e!, 0); });
    seen.push(elapsed());
    for (let k = 1; k <= 6; k++) {
      clients.frames(1);
      if (k === held) client.run(() => BlzSetSpecialEffectTimeScale(e!, 0));
      seen.push(elapsed());
    }
    return held === undefined ? seen : seen[6];
  };
  expect(read(undefined)).toEqual([100, 0, 25, 25, 50, 75, 75]);
  expect([0, 1, 2, 3].map(read)).toEqual([0, 0, 25, 25]);
});

test("[native #118] a yaw set after a matrix scale resets it to 1; the opposite order keeps it", () => {
  const clients = runtime.clients({ install, start: () => {
    const scaleThenYaw = AddSpecialEffect("a.mdx", 0, 0);
    BlzSetSpecialEffectMatrixScale(scaleThenYaw, 2, 0, 3);
    BlzSetSpecialEffectYaw(scaleThenYaw, 1);
    const yawThenScale = AddSpecialEffect("b.mdx", 0, 0);
    BlzSetSpecialEffectYaw(yawThenScale, 1);
    BlzSetSpecialEffectMatrixScale(yawThenScale, 2, 0, 3);
  } });
  clients.start();
  const poses = clients.clients[0]?.effectPoses() ?? [];
  expect(poses.map(pose => [pose.model, pose.yaw, pose.matrixScale, pose.flat])).toEqual([
    ["a.mdx", 1, [1, 1, 1], false],
    ["b.mdx", 1, [2, 0, 3], true],
  ]);
});
