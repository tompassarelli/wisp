import { expect, test } from "bun:test";
import { createModelLibrary } from "../../host/window/drawScene";

const until = async (check: () => boolean) => {
  for (const deadline = Date.now() + 5000; !check() && Date.now() < deadline;) await Bun.sleep(1);
};


test("modelLibrary_gives_the_light_a_day_night_model_holds", async () => {
  const { parseMDX, generateMDX } = await import("../../vendor/war3-model.mjs");
  const fixture = await Bun.file("window/wisp-window/tests/fixtures/rig.mdx").bytes();
  const model = parseMDX(fixture.slice().buffer);
  model.Lights = [{ Name: "Sun", ObjectId: 0, Parent: -1, PivotPoint: new Float32Array(3), Flags: 512, LightType: 1, AttenuationStart: 0, AttenuationEnd: 0, Color: new Float32Array([0.5, 0.75, 1]), Intensity: 2, AmbColor: new Float32Array([0.1, 0.2, 0.3]), AmbIntensity: 1 }];
  const mdx = new Uint8Array(generateMDX(model));
  const library = createModelLibrary(async () => mdx, { asset: () => undefined }, () => undefined);
  expect(library.light("dnc.mdx", 12)).toBeUndefined();
  await until(() => library.loading() === 0);
  const light = library.light("dnc.mdx", 12);
  expect(light?.key).toEqual([2, 1.5, 1]);
  expect(light?.ambient.map((channel) => Math.round(channel * 100) / 100)).toEqual([0.3, 0.2, 0.1]);
});

