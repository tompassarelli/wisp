import { expect, test } from "bun:test";
import type { AnimationSequence } from "../../src/game/native/animation";
import { createModelLibrary, drawScene, preloadAssets } from "../../host/window/drawScene";
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

test("drawScene_reduces_to_loaded_poses", () => {
  const sequences = new Map<string, readonly AnimationSequence[]>([["loaded.mdx", [STAND]]]);
  const drawn = drawScene(scene, { sequences: (path) => sequences.get(path), show: () => undefined, loading: () => 0, light: () => undefined, controlSkin: () => undefined, lightning: () => undefined });
  expect(drawn.poses.map((placed) => placed.model)).toEqual(["loaded.mdx"]);
  expect(drawn.poses[0]?.sequence).toBe(0);
  expect(drawn.poses[0]?.frame).toBe(599);
  expect(drawn.poses[0]?.team).toEqual([0, 66 / 255, 1]);
  expect(drawn.poses[0]?.matrix.slice(12, 15)).toEqual([10, 20, 30]);
  expect(drawn.camera.view).toHaveLength(16);
});

test("modelLibrary_reports_a_missing_model", async () => {
  const pushed: string[] = [], problems: string[] = [];
  const library = createModelLibrary(async (path) => (path === "gone.mdx" ? undefined : new Uint8Array([1, 2, 3, 4])), { asset: (path) => { pushed.push(path); } }, (problem) => problems.push(problem));
  expect(library.sequences("gone.mdx")).toBeUndefined();
  expect(library.sequences("gone.mdx")).toBeUndefined();
  await until(() => library.loading() === 0);
  expect(problems).toEqual(["gone.mdx: missing model"]);
  expect(pushed).toEqual([]);
});

test("drawScene_sends_only_the_ui_frames_that_draw_and_asks_for_their_files", () => {
  const frame = (name: string, over: object) => ({ name, rectangle: [0, 0.1, 0.1, 0], text: "", texture: "", alpha: 255, visible: true, font: { file: "", height: 0, flags: 0 }, ...over });
  const withUi = { ...scene, ui: [frame("tile", { texture: "tile.tga" }), frame("hidden", { texture: "gone.tga", visible: false }), frame("label", { text: "x", font: { file: "Fonts\\a.ttf", height: 0.01, flags: 1 } })] } as unknown as RenderScene;
  const shown: string[][] = [];
  const drawn = drawScene(withUi, { sequences: () => undefined, show: (paths) => shown.push([...paths]), loading: () => 0, light: () => undefined, controlSkin: () => undefined, lightning: () => undefined });
  expect(drawn.ui.map((each) => each.name)).toEqual(["tile", "label"]);
  expect(shown).toEqual([["tile.tga", "Fonts\\a.ttf"]]);
});

test("modelLibrary_pushes_each_ui_file_once_and_counts_it_until_read", async () => {
  const pushed: string[] = [];
  const release = Promise.withResolvers<void>();
  const library = createModelLibrary(async () => { await release.promise; return new Uint8Array([1]); }, { asset: (path) => { pushed.push(path); } }, () => undefined);
  library.show(["a.tga", "b.ttf"]);
  library.show(["a.tga"]);
  expect(library.loading()).toBe(2);
  release.resolve();
  await until(() => library.loading() === 0);
  expect(pushed).toEqual(["a.tga", "b.ttf"]);
  expect(library.loading()).toBe(0);
});

test("modelLibrary_sends_a_shared_texture_before_every_model_that_names_it", async () => {
  const { parseMDX, generateMDX } = await import("../../vendor/war3-model.mjs");
  const fixture = await Bun.file("window/wisp-window/tests/fixtures/rig.mdx").bytes();
  const model = parseMDX(fixture.slice().buffer);
  model.Textures = [{ Image: "shared.blp", ReplaceableId: 0, Flags: 0 }];
  const mdx = new Uint8Array(generateMDX(model));
  const pushed: string[] = [];
  const reads: string[] = [];
  const texture = Promise.withResolvers<void>();
  const library = createModelLibrary(async (path) => { reads.push(path); if (path === "shared.blp") await texture.promise; return path.endsWith(".mdx") ? mdx : new Uint8Array([1]); }, { asset: (path) => { pushed.push(path); } }, () => undefined);
  library.sequences("a.mdx");
  await until(() => reads.includes("shared.blp"));
  library.sequences("b.mdx");
  await until(() => reads.includes("b.mdx"));
  texture.resolve();
  await until(() => library.loading() === 0);
  expect(pushed).toEqual(["shared.blp", "a.mdx", "b.mdx"]);
});

test("drawScene_plays_a_destroyed_effect_once_and_then_drops_it", () => {
  const sequence = (name: string, start: number, end: number, looping: boolean): AnimationSequence => ({ name, start, end, looping, rarity: 0 });
  const withDeath = [sequence("Birth", 0, 1000, false), sequence("Stand", 1000, 3000, true), sequence("Death", 3000, 4000, false)];
  const noDeath = [sequence("Birth", 0, 1000, false), sequence("Stand", 1000, 3000, true)];
  const destroyed = (frame: number, elapsed: number) => ({ ...scene, frame, effects: [{ ...pose("fx.mdx"), destroyed: 10, animationElapsed: elapsed }] } as unknown as RenderScene);
  const drawn = (sequences: readonly AnimationSequence[], frame: number, elapsed: number) => drawScene(destroyed(frame, elapsed), { sequences: () => sequences, show: () => undefined, loading: () => 0, light: () => undefined, controlSkin: () => undefined, lightning: () => undefined }).poses;
  expect(drawn(withDeath, 40, 9)[0]?.sequence).toBe(2);
  expect(Math.abs((drawn(withDeath, 40, 9)[0]?.frame ?? 0) - 3500)).toBeLessThanOrEqual(1);
  expect(drawn(withDeath, 40, 9)).toHaveLength(1);
  expect(drawn(withDeath, 71, 9)).toHaveLength(0);
  expect(drawn(noDeath, 40, 2.5)).toHaveLength(1);
  expect(drawn(noDeath, 400, 3.5)).toHaveLength(0);
});

test("preloadAssets_reads_the_listed_models_and_pushes_the_listed_textures", () => {
  const read: string[] = [], shown: string[] = [];
  preloadAssets({ preloadModels: ["a.mdx", "b.mdx"], preloadTextures: ["hud.blp", "plate.tga"] }, { sequences: (path) => { read.push(path); return undefined; }, show: (paths) => { shown.push(...paths); }, loading: () => 0, light: () => undefined, controlSkin: () => undefined, lightning: () => undefined });
  expect(read).toEqual(["a.mdx", "b.mdx"]);
  expect(shown).toEqual(["hud.blp", "plate.tga"]);
});

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

test("drawScene_sends_each_bolt_with_its_types_look_from_the_installs_lightning_table", async () => {
  const pushed: string[] = [], problems: string[] = [];
  const read = async (path: string) => (path === "Splats\\LightningData.slk" ? new TextEncoder().encode(LIGHTNING_SLK) : new Uint8Array([1]));
  const library = createModelLibrary(read, { asset: (path) => { pushed.push(path); } }, (problem) => problems.push(problem));
  const bolt = (codeName: string) => ({ handle: 1, codeName, from: [0, 0, 0], to: [1, 2, 3], color: [1, 1, 1, 1] });
  const lit = { ...scene, effects: [], lightnings: [bolt("TEST"), bolt("NONE"), bolt("BARE")] } as unknown as RenderScene;
  expect(drawScene(lit, library).lightnings.map((sent) => sent.look)).toEqual([undefined, undefined, undefined]);
  await until(() => library.loading() === 0);
  const sent = drawScene(lit, library).lightnings;
  expect(sent[0]?.look).toEqual({ texture: "Textures\\Bolt.blp", width: 20, segment: 50, noise: 0.5, scale: 2, color: [1, 128 / 255, 0] });
  expect(sent[1]?.look).toBeUndefined();
  expect(sent[2]?.look).toBeUndefined();
  expect(pushed).toEqual(["Textures\\Bolt.blp"]);
  expect(problems).toEqual(["no installed LightningData.slk row for NONE", "LightningData.slk BARE names no file"]);
});

test("modelLibrary_reports_a_lightning_table_column_it_lacks_once", async () => {
  const problems: string[] = [];
  const slk = ["ID;P", "C;X1;Y1;K\"Name\"", "C;X2;Y1;K\"file\"", "C;X3;Y1;K\"AvgSegLen\"", "C;X1;Y2;K\"TEST\"", "C;X2;Y2;K\"Bolt\"", "C;X3;Y2;K50", "C;X1;Y3;K\"TWO\"", "C;X2;Y3;K\"Bolt\"", "C;X3;Y3;K50", "E"].join("\n");
  const read = async (path: string) => (path.endsWith(".slk") ? new TextEncoder().encode(slk) : new Uint8Array([1]));
  const library = createModelLibrary(read, { asset: () => undefined }, (problem) => problems.push(problem));
  library.lightning("TEST");
  library.lightning("TWO");
  await until(() => library.loading() === 0);
  expect(problems.filter((problem) => problem.includes("column"))).toEqual(["Splats\\LightningData.slk has no dir, width, r, g, b, noisescale, texcoordscale column"]);
});
