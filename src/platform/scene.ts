// The scene recorder, for development and diagnostic builds: it reports which
// special effects the map draws, so a host check can fail on a missing stage,
// an effect with no model or one that stays in view too long. At start it
// wraps the effect natives in the Lua globals once, so the game's own code is
// unchanged and a build that never starts it carries none of this. Local to
// this client: it records into Lua tables, reads effect positions with the
// local getters and writes a file, and nothing synchronized reads any of it.
// A reload keeps the wrappers and the records.
import { runtimeConfiguration } from "../runtime/config";
import { type SceneModel, reportedModel, sceneFile, sceneHeading, sceneModelLine } from "../runtime/scene";
import { on, trampoline } from "./dispatch";

const REPORT_SECONDS = 0.5;
const REPORT = "scene.report";

export interface SceneOptions {
  /** The game's frame counter. It should stand still while nothing plays, such as during a pause. */
  readonly frame: (this: void) => number;
  /**
   * Whether a point is where the game parks hidden effects, which no camera
   * sees. Warcraft keeps a model's particle emitters running at any alpha,
   * scale or time scale, so only an effect parked there is out of view.
   */
  readonly parked: (this: void, x: number, y: number, z: number) => boolean;
}

interface Recorded {
  readonly model: string;
  readonly created: number;
  alpha: number;
  scale: number;
  /** A matrix scale of zero on some axis since the matrix was last reset. */
  flat: boolean;
  /** The frame it was first seen in view without a break; undefined while parked. */
  since: number | undefined;
  drawn: boolean;
}

interface SceneState {
  readonly effects: Map<effect, Recorded>;
  /** Per model, the longest one finished a stay in view. */
  readonly longest: Map<string, number>;
  /** Per model, how many were destroyed in view. */
  readonly destroyed: Map<string, number>;
  readonly options: SceneOptions;
  /** Added to the game's frame so this clock keeps rising when the game's restarts, as at a rematch. */
  offset: number;
  last: number;
  serial: number;
}

function scene(): SceneState {
  const globals = globalThis as Record<`${string}SceneReport`, SceneState | undefined>;
  const state = globals[`${runtimeConfiguration().globalPrefix}SceneReport`];
  if (state === undefined) throw new Error("scene report used before startSceneReport");
  return state;
}

function now(state: SceneState): number {
  const frame = state.options.frame();
  if (frame < state.last) state.offset += state.last - frame + 1;
  state.last = frame;
  return state.offset + frame;
}

function leftView(state: SceneState, effect: Recorded, frame: number): void {
  if (effect.since === undefined) return;
  const stayed = frame - effect.since;
  if (stayed > (state.longest.get(effect.model) ?? 0)) state.longest.set(effect.model, stayed);
  effect.since = undefined;
}

function created(state: SceneState, handle: effect, model: string): effect {
  state.effects.set(handle, { model, created: now(state), alpha: 255, scale: 1.0, flat: false, since: undefined, drawn: false });
  return handle;
}

function wrapNatives(state: SceneState): void {
  const add = AddSpecialEffect;
  const addAt = AddSpecialEffectLoc;
  const attach = AddSpecialEffectTarget;
  const destroy = DestroyEffect;
  const setAlpha = BlzSetSpecialEffectAlpha;
  const setScale = BlzSetSpecialEffectScale;
  const setMatrixScale = BlzSetSpecialEffectMatrixScale;
  const resetMatrix = BlzResetSpecialEffectMatrix;
  const natives = globalThis as Record<string, unknown>;
  natives.AddSpecialEffect = (model: string, x: number, y: number) => created(state, add(model, x, y), model);
  natives.AddSpecialEffectLoc = (model: string, where: location) => created(state, addAt(model, where), model);
  natives.AddSpecialEffectTarget = (model: string, target: widget, point: string) => created(state, attach(model, target, point), model);
  natives.DestroyEffect = (handle: effect) => {
    const effect = state.effects.get(handle);
    if (effect !== undefined) {
      leftView(state, effect, now(state));
      state.effects.delete(handle);
      // Warcraft plays the death animation where the effect stands, and its emitters with it.
      if (!state.options.parked(BlzGetLocalSpecialEffectX(handle), BlzGetLocalSpecialEffectY(handle), BlzGetLocalSpecialEffectZ(handle))) {
        state.destroyed.set(effect.model, (state.destroyed.get(effect.model) ?? 0) + 1);
      }
    }
    destroy(handle);
  };
  // The game poses its effects every frame through these, so they only store a value.
  natives.BlzSetSpecialEffectAlpha = (handle: effect, alpha: number) => {
    const effect = state.effects.get(handle);
    if (effect !== undefined) effect.alpha = alpha;
    setAlpha(handle, alpha);
  };
  natives.BlzSetSpecialEffectScale = (handle: effect, scale: number) => {
    const effect = state.effects.get(handle);
    if (effect !== undefined) effect.scale = scale;
    setScale(handle, scale);
  };
  natives.BlzSetSpecialEffectMatrixScale = (handle: effect, x: number, y: number, z: number) => {
    const effect = state.effects.get(handle);
    if (effect !== undefined) effect.flat = effect.flat || x === 0 || y === 0 || z === 0;
    setMatrixScale(handle, x, y, z);
  };
  natives.BlzResetSpecialEffectMatrix = (handle: effect) => {
    const effect = state.effects.get(handle);
    if (effect !== undefined) effect.flat = false;
    resetMatrix(handle);
  };
}

/** Where each effect stands now: in view since when, and whether its model is drawn. */
function observe(state: SceneState, frame: number): void {
  const { parked } = state.options;
  for (const [handle, effect] of state.effects) {
    const inView = !parked(BlzGetLocalSpecialEffectX(handle), BlzGetLocalSpecialEffectY(handle), BlzGetLocalSpecialEffectZ(handle));
    if (!inView) leftView(state, effect, frame);
    else effect.since ??= frame;
    effect.drawn = inView && effect.alpha > 0 && effect.scale > 0 && !effect.flat;
  }
}

interface Summary {
  live: number;
  inView: number;
  drawn: number;
  created: number;
  since: number | undefined;
}

/** Every model's line, in path order. */
function sceneModels(state: SceneState, frame: number): SceneModel[] {
  const summaries = new Map<string, Summary>();
  for (const effect of state.effects.values()) {
    const summary = summaries.get(effect.model) ?? { live: 0, inView: 0, drawn: 0, created: effect.created, since: undefined };
    summaries.set(effect.model, summary);
    summary.live++;
    summary.created = Math.min(summary.created, effect.created);
    if (effect.drawn) summary.drawn++;
    if (effect.since === undefined) continue;
    summary.inView++;
    summary.since = Math.min(summary.since ?? effect.since, effect.since);
  }
  const models = [...new Set([...summaries.keys(), ...state.longest.keys(), ...state.destroyed.keys()])].sort();
  return models.map((model) => {
    const summary = summaries.get(model);
    const age = summary?.since === undefined ? undefined : frame - summary.since;
    return {
      model: reportedModel(model),
      live: summary?.live ?? 0,
      inView: summary?.inView ?? 0,
      drawn: summary?.drawn ?? 0,
      created: summary?.created,
      age,
      longest: Math.max(state.longest.get(model) ?? 0, age ?? 0),
      destroyed: state.destroyed.get(model) ?? 0,
    };
  });
}

function writeReport(): void {
  const state = scene();
  const frame = now(state);
  observe(state, frame);
  state.serial++;
  PreloadGenClear();
  PreloadGenStart();
  Preload(sceneHeading(state.serial, frame, state.effects.size));
  for (const model of sceneModels(state, frame)) Preload(sceneModelLine(model));
  PreloadGenEnd(sceneFile(GetPlayerId(GetLocalPlayer()), runtimeConfiguration().filePrefix));
}

/** Registers the report's handler; a reloaded bundle calls this again. */
export function installSceneReport(): void {
  on(REPORT, writeReport);
}

/**
 * Starts recording and, every half second of game time, observing and
 * reporting. Call once, after configureRuntime and before the map creates an
 * effect.
 */
export function startSceneReport(options: SceneOptions): void {
  const globals = globalThis as Record<`${string}SceneReport`, SceneState | undefined>;
  const key = `${runtimeConfiguration().globalPrefix}SceneReport` as const;
  if (globals[key] !== undefined) return;
  const state: SceneState = { effects: new Map(), longest: new Map(), destroyed: new Map(), options, offset: 0, last: options.frame(), serial: 0 };
  globals[key] = state;
  wrapNatives(state);
  installSceneReport();
  TimerStart(CreateTimer(), REPORT_SECONDS, true, trampoline(REPORT));
}
