import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./effects59/main";
import { DYING, EFFECT_NOOPS } from "./effects59/cases";
import { EFFECT_DEATHS, deathTimeline } from "./effects59/deaths";
import { EXPECTED, DEATH_TIMELINE } from "./effects59/expected";

const runtime = installHeadless({ filePrefix: "effects", globalPrefixes: ["__effects59"], intentionalNoops: EFFECT_NOOPS });
afterAll(runtime.restore);

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
