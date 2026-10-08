import { expect, test } from "bun:test";
import { Effect } from "effect";
import { headlessArguments } from "../scripts/wisp/commands/headless";
import { renderScenes } from "../scripts/wisp/headlessRender";

const project = { readAsset: async () => undefined };

test("[wisp#79] a look check asking for a lever Wisp does not draw in its graphics mode fails with that lever's name, before drawing", async () => {
  const failure = await Effect.runPromise(Effect.flip(renderScenes(project, [], "/nonexistent", "definitive", ["point-lights", "bloom", "ambient-occlusion"])));
  expect(String(failure.cause)).toContain("bloom, ambient-occlusion, which Wisp does not draw in definitive");
  expect(String(failure.cause)).not.toContain("point-lights");
});

test("[wisp#79] Classic draws no bloom or model omni light either, so asking for them there is no gap", () => {
  const options = headlessArguments(["--render", "/tmp/out", "--frames", "1", "--look", "bloom,point-lights"]);
  expect(options.graphics).toBe("classic");
  expect(options.look).toEqual(["bloom", "point-lights"]);
});

test("[wisp#79] the graphics modes are Classic and Definitive; Reforged and unknown levers are refused", () => {
  expect(headlessArguments(["--render", "/tmp/out", "--frames", "1", "--graphics", "definitive"]).graphics).toBe("definitive");
  expect(() => headlessArguments(["--render", "/tmp/out", "--frames", "1", "--graphics", "reforged"])).toThrow("--graphics is classic or definitive");
  expect(() => headlessArguments(["--render", "/tmp/out", "--frames", "1", "--look", "lens-flare"])).toThrow("unknown lever lens-flare");
});
