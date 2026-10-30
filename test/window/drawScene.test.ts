import { expect, test } from "bun:test";
import type { AnimationSequence } from "../../src/headless/animation";
import { createModelLibrary, drawScene } from "../../host/window/drawScene";
import type { RenderScene } from "../../host/render/renderScene";

const STAND: AnimationSequence = { name: "Stand", start: 100, end: 1100, looping: true, rarity: 0 };
const pose = (model: string) => ({
  handle: { kind: "effect", id: 1 }, model, created: 0, x: 10, y: 20, z: 30, alpha: 255, scale: 1, timeScale: 1, flat: false, queuedAnimations: [], yaw: 0, pitch: 0, roll: 0,
  color: [255, 255, 255], teamColor: 1, matrixScale: [1, 1, 1], animation: undefined, subAnimations: [], animationElapsed: 0.5, animationClock: 0.5, animationBlendTime: 0, animationBlend: undefined,
});
const scene = { frame: 0, client: 0, effects: [pose("loaded.mdx"), pose("loading.mdx")], units: [], camera: { x: 0, y: 0, fields: {} }, ui: [], environment: { sky: "", skyVisible: false } } as unknown as RenderScene;

test("drawScene_reduces_to_loaded_poses", () => {
  const sequences = new Map<string, readonly AnimationSequence[]>([["loaded.mdx", [STAND]]]);
  const drawn = drawScene(scene, { sequences: (path) => sequences.get(path), show: () => undefined, loading: () => 0 });
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
  await Bun.sleep(10);
  expect(problems).toEqual(["gone.mdx: missing model"]);
  expect(pushed).toEqual([]);
});

test("drawScene_sends_only_the_ui_frames_that_draw_and_asks_for_their_files", () => {
  const frame = (name: string, over: object) => ({ name, rectangle: [0, 0.1, 0.1, 0], text: "", texture: "", alpha: 255, visible: true, font: { file: "", height: 0, flags: 0 }, ...over });
  const withUi = { ...scene, ui: [frame("tile", { texture: "tile.tga" }), frame("hidden", { texture: "gone.tga", visible: false }), frame("label", { text: "x", font: { file: "Fonts\\a.ttf", height: 0.01, flags: 1 } })] } as unknown as RenderScene;
  const shown: string[][] = [];
  const drawn = drawScene(withUi, { sequences: () => undefined, show: (paths) => shown.push([...paths]), loading: () => 0 });
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
  await Bun.sleep(10);
  expect(pushed).toEqual(["a.tga", "b.ttf"]);
  expect(library.loading()).toBe(0);
});
