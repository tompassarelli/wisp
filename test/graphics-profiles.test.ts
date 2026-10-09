import { expect, test } from "bun:test";
import { Effect } from "effect";
import { headlessArguments } from "../scripts/wisp/commands/headless";
import { renderScenes } from "../scripts/wisp/headlessRender";
import { parsePostProcessing, postSettings, sunView } from "../scripts/wisp/browser/passes";

const project = { readAsset: async () => undefined };

test("[wisp#79] a look check asking for a lever Wisp does not draw in its graphics mode fails with that lever's name, before drawing", async () => {
  const failure = await Effect.runPromise(Effect.flip(renderScenes(project, [], "/nonexistent", "definitive", ["point-lights", "shadows", "point-light-shadows", "bloom", "ambient-occlusion", "water", "height-fog-falloff", "terrain"])));
  expect(String(failure.cause)).toContain("the look check asks for terrain, which Wisp does not draw in definitive");
  const classic = await Effect.runPromise(Effect.flip(renderScenes(project, [], "/nonexistent", "classic", ["shadows", "terrain"])));
  expect(String(classic.cause)).toContain("the look check asks for terrain, which Wisp does not draw in classic");
});

test("[wisp#79] the map's war3mapPostProcessing.txt overrides the stock PostProcessingConfig.txt key by key, and bloom draws only when a file enables it", () => {
  const stock = "[ASSAO]\r\nEnabled=1\r\nRadius=40\r\nShadowMultiplier=1.20000\r\nShadowPower=5.000000\r\n\r\n[Bloom]\r\nEnabled=0\r\nBloomThreshold=0.72\r\nBlurAmount=3.75\r\n";
  expect(postSettings(parsePostProcessing(stock)).bloom).toBeUndefined();
  const map = postSettings(parsePostProcessing(stock, "[ASSAO]\r\nRadius=6.000000\r\nShadowMultiplier=3.000000\r\n\r\n[Bloom]\r\nEnabled=1\r\nBloomThreshold=0.900000\r\n"));
  expect(map.occlusion).toMatchObject({ radius: 6, strength: 3, power: 5 });
  expect(map.bloom).toMatchObject({ threshold: 0.9, blur: 3.75 });
  expect(postSettings(parsePostProcessing("[ASSAO]\nEnabled=0\n")).occlusion).toBeUndefined();
});

test("[wisp#79] the sun's shadow map covers every corner of the camera's visible slice, with room toward the sun for casters above it", () => {
  const camera = { eye: [0, -1650, 300], right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0], tangent: Math.tan(35 * Math.PI / 180), aspect: 16 / 9, near: 10, reach: 4125 };
  const sun = sunView(camera, [0.3, -0.4, 0.866]);
  for (const depth of [camera.near, camera.reach]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const half = depth * camera.tangent, point = [sx * half, -1650 + depth, 300 + sy * half / camera.aspect, 1];
    const clip = [0, 1, 2].map((row) => [0, 1, 2, 3].reduce((sum, k) => sum + (sun.viewProjection[k * 4 + row] ?? 0) * (point[k] ?? 0), 0));
    for (const value of clip) expect(Math.abs(value)).toBeLessThanOrEqual(1.0001);

    const raised = [point[0]! + 0.3 * 3000, point[1]! - 0.4 * 3000, point[2]! + 0.866 * 3000, 1];
    const z = [0, 1, 2, 3].reduce((sum, k) => sum + (sun.viewProjection[k * 4 + 2] ?? 0) * (raised[k] ?? 0), 0);
    expect(z).toBeGreaterThanOrEqual(-1);
  }
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
