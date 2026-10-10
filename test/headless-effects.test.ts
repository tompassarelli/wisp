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
