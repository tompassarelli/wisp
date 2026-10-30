import { Effect } from "effect";
import { type AnimationSequence, animationSample } from "../../src/headless/animation";
import { parseMDX } from "../../vendor/war3-model.mjs";
import { parsableModel } from "../models/models";
import { drawnPoses } from "../render/culling";
import { nativeUi, uiAssets } from "./nativeUi";
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
const NEUTRAL_TEAM = [160, 160, 160];

export type AssetReader = (path: string) => Promise<Uint8Array | undefined>;

/** Where models and textures go once read: the native window, which uploads them before it draws its next scene. */
export interface AssetSink {
  asset(path: string, bytes: Uint8Array): void;
}

type Entry = { readonly sequences: readonly AnimationSequence[] } | "loading" | "failed";

/** What the scene needs from the model library: the sequences of a model that is loaded, the pushing of the files its UI names, and how many files are still being read. */
export interface ModelLibrary {
  sequences(path: string): readonly AnimationSequence[] | undefined;
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
  const load = async (path: string) => {
    const bytes = await read(path);
    if (bytes === undefined) throw new Error("missing model");
    const parsable = parsableModel(bytes).bytes;
    const model = parseMDX(parsable.slice().buffer);
    await Promise.all(model.Textures.filter((texture) => texture.Image !== "" && (texture.ReplaceableId ?? 0) === 0).map((texture) => push(texture.Image)));
    sink.asset(path, parsable);
    return model.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity }));
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
        load(path).then((sequences) => { entries.set(path, { sequences }); reading--; }, (cause: unknown) => { entries.set(path, "failed"); reading--; report(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`); });
        return undefined;
      }
      return typeof known === "string" ? undefined : known.sequences;
    },
  };
}

function fogOf(scene: RenderScene) {
  const fog = scene.environment.fog;
  if (fog === undefined || fog.drawOverSky === true) return undefined;
  const height = fog.style === 3;
  return { color: fog.color, start: height ? fog.linearStart ?? fog.zStart : fog.zStart, end: height ? fog.linearEnd ?? fog.zEnd : fog.zEnd, max: fog.maxLinearDensity ?? 1 };
}

/** The scene the native renderer draws: the camera, the fog, the sky and each model that is already loaded, with the sequence and frame the game's animation rules pick for it. */
export function drawScene(scene: RenderScene, library: ModelLibrary) {
  const view = camera(scene, 1);
  const place = (pose: DrawnPose): NativePose | undefined => {
    const sequences = library.sequences(pose.model);
    if (sequences === undefined) return undefined;
    const sample = animationSample(sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, pose.unit === true ? "unit" : "effect");
    return { id: pose.handle.id, model: pose.model, matrix: Array.from(transform(pose)), sequence: sample.sequence, frame: sample.frame, clock: pose.animationClock, alpha: pose.alpha / 255, color: pose.color.map((value) => value / 255), team: (TEAMS[pose.teamColor] ?? NEUTRAL_TEAM).map((value) => value / 255) };
  };
  const ui = nativeUi(scene.ui);
  library.show(uiAssets(ui));
  const environment = scene.environment;
  const sky = environment.sky !== "" && environment.skyVisible ? place({ handle: { id: 0 }, model: environment.sky, x: 0, y: 0, z: 0, alpha: 255, scale: 1, flat: false, animation: undefined, subAnimations: [], animationElapsed: 0, animationClock: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], yaw: 0, pitch: 0, roll: 0 } as unknown as DrawnPose) : undefined;
  const poses = drawnPoses(scene.effects, view.eye, view.far, scene.world).flatMap((pose) => place(pose) ?? []);
  return { frame: scene.frame, pending: library.loading(), camera: { view: Array.from(view.view), eye: view.eye, tangent: view.shadow.tangent, near: view.near, far: view.far, skyFar: SKY_FAR, rise: NATIVE_RISE }, fog: fogOf(scene), sky, poses, lightnings: (scene.lightnings ?? []).map((bolt) => ({ from: bolt.from, to: bolt.to, color: bolt.color })), ui };
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
