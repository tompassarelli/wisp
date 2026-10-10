import { runtimeConfiguration } from "../runtime/config";
import { type SceneModel, reportedModel, sceneFile, sceneHeading, sceneModelLine, sceneReportGlobal } from "../runtime/scene";
import { on, trampoline } from "./dispatch";

const REPORT_SECONDS = 0.5;
const REPORT = "scene.report";

export interface SceneOptions {

  readonly frame: (this: void) => number;
  // Particle emitters keep running at any alpha, scale or time scale; hidden effects must be parked off camera.

  readonly parked: (this: void, x: number, y: number, z: number) => boolean;

  readonly unitModel?: ((this: void, unitType: number) => string | undefined) | undefined;
}

interface Recorded {
  readonly model: string;
  readonly created: number;
  alpha: number;
  scale: number;

  flat: boolean;

  since: number | undefined;
  drawn: boolean;
}

interface RecordedUnit extends Recorded {
  hidden: boolean;
}

interface SceneState {
  readonly effects: Map<effect, Recorded>;
  readonly units: Map<unit, RecordedUnit>;

  readonly longest: Map<string, number>;

  readonly destroyed: Map<string, number>;
  readonly options: SceneOptions;

  offset: number;
  last: number;
  serial: number;
}

function scene(): SceneState {
  const globals = globalThis as Record<`${string}SceneReport`, SceneState | undefined>;
  const state = globals[sceneReportGlobal(runtimeConfiguration().globalPrefix)];
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

function placed(state: SceneState, effect: Recorded, x: number, y: number, z: number): void {
  if (state.options.parked(x, y, z)) leftView(state, effect, now(state));
  else effect.since ??= now(state);
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
  const setYaw = BlzSetSpecialEffectYaw;
  const setPosition = BlzSetSpecialEffectPosition;
  const setX = BlzSetSpecialEffectX;
  const setY = BlzSetSpecialEffectY;
  const setZ = BlzSetSpecialEffectZ;
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
  natives.BlzSetSpecialEffectYaw = (handle: effect, yaw: number) => {
    const effect = state.effects.get(handle);
    if (effect !== undefined) effect.flat = false;
    setYaw(handle, yaw);
  };

  natives.BlzSetSpecialEffectPosition = (handle: effect, x: number, y: number, z: number) => {
    setPosition(handle, x, y, z);
    const effect = state.effects.get(handle);
    if (effect !== undefined) placed(state, effect, x, y, z);
  };
  natives.BlzSetSpecialEffectX = (handle: effect, x: number) => {
    setX(handle, x);
    const effect = state.effects.get(handle);
    if (effect !== undefined) placed(state, effect, x, BlzGetLocalSpecialEffectY(handle), BlzGetLocalSpecialEffectZ(handle));
  };
  natives.BlzSetSpecialEffectY = (handle: effect, y: number) => {
    setY(handle, y);
    const effect = state.effects.get(handle);
    if (effect !== undefined) placed(state, effect, BlzGetLocalSpecialEffectX(handle), y, BlzGetLocalSpecialEffectZ(handle));
  };
  natives.BlzSetSpecialEffectZ = (handle: effect, z: number) => {
    setZ(handle, z);
    const effect = state.effects.get(handle);
    if (effect !== undefined) placed(state, effect, BlzGetLocalSpecialEffectX(handle), BlzGetLocalSpecialEffectY(handle), z);
  };
  const { unitModel } = state.options;
  if (unitModel !== undefined) wrapUnitNatives(state, unitModel);
}

function wrapUnitNatives(state: SceneState, unitModel: (this: void, unitType: number) => string | undefined): void {
  const create = CreateUnit;
  const remove = RemoveUnit;
  const show = ShowUnit;
  const setColor = SetUnitVertexColor;
  const setScale = SetUnitScale;
  const natives = globalThis as Record<string, unknown>;
  natives.CreateUnit = (owner: player, unitType: number, x: number, y: number, facing: number) => {
    const handle = create(owner, unitType, x, y, facing);
    const model = unitModel(unitType);
    if (model !== undefined) {
      const frame = now(state);
      state.units.set(handle, { model, created: frame, alpha: 255, scale: 1.0, flat: false, since: frame, drawn: false, hidden: false });
    }
    return handle;
  };
  natives.RemoveUnit = (handle: unit) => {
    const recorded = state.units.get(handle);
    if (recorded !== undefined) {
      leftView(state, recorded, now(state));
      state.units.delete(handle);
    }
    remove(handle);
  };
  natives.ShowUnit = (handle: unit, shown: boolean) => {
    show(handle, shown);
    const recorded = state.units.get(handle);
    if (recorded === undefined) return;
    recorded.hidden = !shown;
    if (shown) recorded.since ??= now(state);
    else leftView(state, recorded, now(state));
  };
  natives.SetUnitVertexColor = (handle: unit, red: number, green: number, blue: number, alpha: number) => {
    const recorded = state.units.get(handle);
    if (recorded !== undefined) recorded.alpha = alpha;
    setColor(handle, red, green, blue, alpha);
  };
  natives.SetUnitScale = (handle: unit, x: number, y: number, z: number) => {
    const recorded = state.units.get(handle);
    if (recorded !== undefined) {
      recorded.scale = x;
      recorded.flat = x === 0 || y === 0 || z === 0;
    }
    setScale(handle, x, y, z);
  };
}

function observe(state: SceneState, frame: number): void {
  const { parked } = state.options;
  for (const [handle, effect] of state.effects) {
    const inView = !parked(BlzGetLocalSpecialEffectX(handle), BlzGetLocalSpecialEffectY(handle), BlzGetLocalSpecialEffectZ(handle));
    if (!inView) leftView(state, effect, frame);
    else effect.since ??= frame;
    effect.drawn = inView && effect.alpha > 0 && effect.scale > 0 && !effect.flat;
  }
  for (const recorded of state.units.values()) recorded.drawn = !recorded.hidden && recorded.alpha > 0 && recorded.scale > 0 && !recorded.flat;
}

interface Summary {
  live: number;
  inView: number;
  drawn: number;
  created: number;
  since: number | undefined;
}

function sceneModels(state: SceneState, frame: number): SceneModel[] {
  const summaries = new Map<string, Summary>();
  for (const effect of [...state.effects.values(), ...state.units.values()]) {
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

export function installSceneReport(): void {
  on(REPORT, writeReport);
}

export function startSceneReport(options: SceneOptions): void {
  const globals = globalThis as Record<`${string}SceneReport`, SceneState | undefined>;
  const key = sceneReportGlobal(runtimeConfiguration().globalPrefix);
  if (globals[key] !== undefined) return;
  const state: SceneState = { effects: new Map(), units: new Map(), longest: new Map(), destroyed: new Map(), options, offset: 0, last: options.frame(), serial: 0 };
  globals[key] = state;
  wrapNatives(state);
  installSceneReport();
  TimerStart(CreateTimer(), REPORT_SECONDS, true, trampoline(REPORT));
}
