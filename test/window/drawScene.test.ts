import { expect, test } from "bun:test";
import type { AnimationSequence } from "../../src/game/native/animation";
import { createModelLibrary, drawScene } from "../../host/window/drawScene";
import type { RenderScene } from "../../host/render/renderScene";

const until = async (check: () => boolean) => {
  for (const deadline = Date.now() + 5000; !check() && Date.now() < deadline;) await Bun.sleep(1);
};

const STAND: AnimationSequence = { name: "Stand", start: 100, end: 1100, looping: true, rarity: 0 };
const pose = (model: string) => ({
  handle: { kind: "effect", id: 1 }, model, created: 0, x: 10, y: 20, z: 30, alpha: 255, scale: 1, timeScale: 1, flat: false, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0,
  color: [255, 255, 255], teamColor: 1, matrixScale: [1, 1, 1], animation: undefined, subAnimations: [], animationElapsed: 0.5, animationClock: 0.5, animationBlendTime: 0, animationBlend: undefined,
});
const scene = { frame: 0, client: 0, effects: [pose("loaded.mdx"), pose("loading.mdx")], units: [], camera: { x: 0, y: 0, fields: {} }, ui: [], environment: { sky: "", skyVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } } as unknown as RenderScene;

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

const LIGHTNING_SLK = [
  "ID;P", "C;X1;Y1;K\"Name\"", "C;X2;Y1;K\"Dir\"", "C;X3;Y1;K\"file\"", "C;X4;Y1;K\"AvgSegLen\"", "C;X5;Y1;K\"Width\"", "C;X6;Y1;K\"R\"", "C;X7;Y1;K\"G\"", "C;X8;Y1;K\"B\"", "C;X9;Y1;K\"NoiseScale\"", "C;X10;Y1;K\"TexCoordScale\"",
  "C;X1;Y2;K\"TEST\"", "C;X2;Y2;K\"Textures\"", "C;X3;Y2;K\"Bolt\"", "C;X4;Y2;K50", "C;X5;Y2;K20", "C;X6;Y2;K255", "C;X7;Y2;K128", "C;X8;Y2;K0", "C;X9;Y2;K0.5", "C;X10;Y2;K2",
  "C;X1;Y3;K\"BARE\"", "C;X2;Y3;K\"\"", "C;X3;Y3;K\"\"", "E",
].join("\n");
