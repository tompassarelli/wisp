import { Effect } from "effect";
import { type AnimationSequence, animationSample } from "../../src/headless/animation";
import { parseMDX } from "../../vendor/war3-model.mjs";
import { parsableModel } from "../models/models";
import { drawnPoses } from "../render/culling";
import { nativeUi, uiAssets } from "./nativeUi";
import { destroyedSample } from "./destroyedEffect";
import type { FrameSnapshot } from "../../src/headless/frames";
import type { DrawnPose, RenderScene } from "../render/renderScene";
import { NATIVE_RISE, SKY_FAR, camera, transform } from "../render/screen";

/** The pose of one model the native renderer draws (window/wisp-window/src/render/scene.rs). */
interface NativePose {
  readonly id: number;
  readonly model: string;
  readonly matrix: number[];
  readonly sequence: number;
  readonly frame: number;
  readonly clock: number;
  readonly alpha: number;
  readonly color: number[];
  readonly team: number[];
}

const TEAMS = [[255, 3, 3], [0, 66, 255], [28, 230, 185], [84, 0, 129], [255, 252, 1], [254, 138, 14], [32, 192, 0], [229, 91, 176], [149, 150, 151], [126, 191, 241], [16, 98, 70], [78, 42, 4]];
/** Warcraft ships 45 water frames per tileset; the push stops at the first one the install lacks. */
const MAX_WATER_FRAMES = 64;
const NEUTRAL_TEAM = [160, 160, 160];

export type AssetReader = (path: string) => Promise<Uint8Array | undefined>;

/** Where models and textures go once read: the native window, which uploads them before it draws its next scene. */
export interface AssetSink {
  asset(path: string, bytes: Uint8Array): void;
}

/** A sequence's box (minimum then maximum corner) in model units. */
export type Extent = readonly [number, number, number, number, number, number];

type Entry = { readonly sequences: readonly AnimationSequence[]; readonly extents: readonly Extent[]; readonly extent: Extent } | "loading" | "failed";

/** What the scene needs from the model library: the sequences of a model that is loaded, the pushing of the files its UI names, and how many files are still being read. */
export interface ModelLibrary {
  sequences(path: string): readonly AnimationSequence[] | undefined;
  /** The box a loaded model fills while playing `sequence`, else its whole-model box. */
  extent(path: string, sequence: number): Extent | undefined;
  /** Reads and pushes each file once, so the window can draw the frames that name them. */
  show(paths: readonly string[]): void;
  loading(): number;
}

/**
 * Reads each model a scene names, once, and pushes it and the textures it paints with to the window; until a model is pushed its poses are left out.
 * The sequences stay here because choosing one (wisp:src/headless/animation.ts) is the game's rule, shared with bounds and capture.
 */
export function createModelLibrary(read: AssetReader, sink: AssetSink, report: (problem: string) => void): ModelLibrary {
  const entries = new Map<string, Entry>();
  const pushed = new Map<string, Promise<void>>();
  const push = (path: string): Promise<void> => {
    const known = pushed.get(path);
    if (known !== undefined) return known;
    const started = (async () => {
      const bytes = await read(path);
      if (bytes === undefined) return report(`missing asset ${path}`);
      sink.asset(path, bytes);
    })();
    pushed.set(path, started);
    return started;
  };
  const isWaterFrame = (image: string) => /^replaceabletextures[\\/]water[\\/]water\d+\.blp$/i.test(image);
  const pushWaterFrames = async () => {
    for (let index = 0; index < MAX_WATER_FRAMES; index++) {
      const path = `ReplaceableTextures\\Water\\Water${String(index).padStart(2, "0")}.blp`;
      if (pushed.has(path)) continue;
      const bytes = await read(path).catch(() => undefined);
      if (bytes === undefined) return;
      pushed.set(path, Promise.resolve());
      sink.asset(path, bytes);
    }
  };
  const load = async (path: string) => {
    const bytes = await read(path);
    if (bytes === undefined) throw new Error("missing model");
    const parsable = parsableModel(bytes).bytes;
    const model = parseMDX(parsable.slice().buffer);
    const painted = model.Textures.filter((texture) => texture.Image !== "" && (texture.ReplaceableId ?? 0) === 0);
    await Promise.all(painted.filter((texture) => !isWaterFrame(texture.Image)).map((texture) => push(texture.Image)));
    if (painted.some((texture) => isWaterFrame(texture.Image))) await pushWaterFrames();
    sink.asset(path, parsable);
    const box = (low: ArrayLike<number> | null | undefined, high: ArrayLike<number> | null | undefined): Extent | undefined =>
      low && high && (high[0] ?? 0) > (low[0] ?? 0) ? [low[0] ?? 0, low[1] ?? 0, low[2] ?? 0, high[0] ?? 0, high[1] ?? 0, high[2] ?? 0] : undefined;
    const whole = box(model.Info.MinimumExtent, model.Info.MaximumExtent) ?? [-50, -50, 0, 50, 50, 100];
    return {
      sequences: model.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity })),
      extents: model.Sequences.map((sequence) => box(sequence.MinimumExtent, sequence.MaximumExtent) ?? whole),
      extent: whole,
    };
  };
  let reading = 0;
  return {
    loading: () => reading,
    show(paths: readonly string[]): void {
      for (const path of paths) {
        if (pushed.has(path)) continue;
        reading++;
        void push(path).finally(() => { reading--; });
      }
    },
    sequences(path: string): readonly AnimationSequence[] | undefined {
      const known = entries.get(path);
      if (known === undefined) {
        entries.set(path, "loading");
        reading++;
        load(path).then((loaded) => { entries.set(path, loaded); reading--; }, (cause: unknown) => { entries.set(path, "failed"); reading--; report(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`); });
        return undefined;
      }
      return typeof known === "string" ? undefined : known.sequences;
    },
    extent(path: string, sequence: number): Extent | undefined {
      const known = entries.get(path);
      return known === undefined || typeof known === "string" ? undefined : known.extents[sequence] ?? known.extent;
    },
  };
}

/** A SPRITE frame as the window draws it: the sequence its animation index names, the frame it shows `seconds` into the screen and the box to fit the camera to. */
function spriteOf(frame: FrameSnapshot, library: ModelLibrary, seconds: number) {
  const sprite = frame.sprite;
  if (sprite === undefined) return undefined;
  const sequences = library.sequences(sprite.model);
  const sequence = sequences?.[sprite.animation];
  const bounds = library.extent(sprite.model, sprite.animation);
  if (sequence === undefined || bounds === undefined) return undefined;
  const length = sequence.end - sequence.start;
  const into = seconds * 1000;
  const time = sprite.time >= 0 ? sprite.time * 1000 : length <= 0 ? sequence.start : sequence.start + (sequence.looping ? into % length : Math.min(into, length));
  const team = [(frame.color >> 16) & 255, (frame.color >> 8) & 255, frame.color & 255].map((value) => value / 255);
  return { model: sprite.model, sequence: sprite.animation, frame: time, clock: seconds, bounds, team };
}

function fogOf(scene: RenderScene) {
  const fog = scene.environment.fog;
  if (fog === undefined || fog.drawOverSky === true) return undefined;
  const height = fog.style === 3;
  return { color: fog.color, start: height ? fog.linearStart ?? fog.zStart : fog.zStart, end: height ? fog.linearEnd ?? fog.zEnd : fog.zEnd, max: fog.maxLinearDensity ?? 1 };
}

/** Which liquid the water pass draws, told from the model paths a scene names: a lava or poison model asks for its own look, anything else is water. */
export function liquidPreset(models: readonly string[]): "water" | "poison" | "lava" {
  if (models.some((model) => /lava|magma|molten/i.test(model))) return "lava";
  if (models.some((model) => /poison|plague|ooze|slime|toxic/i.test(model))) return "poison";
  return "water";
}

/** The scene the native renderer draws: the camera, the fog, the sky and each model that is already loaded, with the sequence and frame the game's animation rules pick for it. */
export function drawScene(scene: RenderScene, library: ModelLibrary) {
  const view = camera(scene, 1);
  const place = (pose: DrawnPose): NativePose | undefined => {
    const sequences = library.sequences(pose.model);
    if (sequences === undefined) return undefined;
    const destroyed = destroyedSample(pose, sequences, scene.frame);
    if (destroyed === "gone") return undefined;
    const sample = destroyed ?? animationSample(sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, pose.unit === true ? "unit" : "effect");
    return { id: pose.handle.id, model: pose.model, matrix: Array.from(transform(pose)), sequence: sample.sequence, frame: sample.frame, clock: pose.animationClock, alpha: pose.alpha / 255, color: pose.color.map((value) => value / 255), team: (TEAMS[pose.teamColor] ?? NEUTRAL_TEAM).map((value) => value / 255) };
  };
  const frames = nativeUi(scene.ui);
  library.show(uiAssets(frames));
  const ui = frames.map((frame) => (frame.sprite === undefined ? frame : { ...frame, sprite: spriteOf(frame, library, scene.frame / 60) }));
  const environment = scene.environment;
  const sky = environment.sky !== "" && environment.skyVisible ? place({ handle: { id: 0 }, model: environment.sky, x: 0, y: 0, z: 0, alpha: 255, scale: 1, flat: false, animation: undefined, subAnimations: [], animationElapsed: 0, animationClock: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], yaw: 0, pitch: 0, roll: 0 } as unknown as DrawnPose) : undefined;
  const poses = drawnPoses(scene.effects, view.eye, view.far, scene.world).flatMap((pose) => place(pose) ?? []);
  return { frame: scene.frame, pending: library.loading(), camera: { view: Array.from(view.view), eye: view.eye, tangent: view.shadow.tangent, near: view.near, far: view.far, skyFar: SKY_FAR, rise: NATIVE_RISE }, fog: fogOf(scene), sky, poses, lightnings: (scene.lightnings ?? []).map((bolt) => ({ from: bolt.from, to: bolt.to, color: bolt.color })), weathers: (scene.weathers ?? []).map((weather) => ({ id: weather.id, rect: weather.rect })), ui, water: { preset: liquidPreset(poses.map((pose) => pose.model)) } };
}

const PRELOAD_MS = 120_000;

/** Reads every model `scene` names and waits until the window has built them all: the visible scene loads before the game's first step. */
export const preloadScene = (scene: RenderScene, library: ModelLibrary, pending: () => number) => Effect.gen(function*() {
  const began = performance.now();
  for (;;) {
    const drawn = drawScene(scene, library);
    if (drawn.pending === 0 && pending() === 0) return;
    if (performance.now() - began > PRELOAD_MS) return yield* Effect.die(new Error(`the first scene's models did not load in ${PRELOAD_MS / 1000} s`));
    yield* Effect.sleep("5 millis");
  }
});
