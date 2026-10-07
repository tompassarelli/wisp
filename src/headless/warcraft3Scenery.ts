import type { Handle, NativeBehavior } from "./client";
import { f32 } from "../sim/f32";

export interface DoodadFixture {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  readonly usingModelAxes: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly variation: number;
}
export interface DoodadState extends DoodadFixture {
  color?: unknown;
  animation?: string;
  animationRandom?: boolean;
}
export interface SceneryFixtures {
  readonly doodads?: readonly DoodadFixture[];
  readonly cinematics?: Readonly<Record<string, readonly number[]>>;
  readonly pathing?: readonly { readonly x: number; readonly y: number; readonly type: unknown; readonly blocked: boolean }[];
  readonly hudScale?: number;
}
export interface DestructableState extends Handle {
  readonly typeId: number;
  readonly skinId: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  roll: number;
  pitch: number;
  scale: number;
  variation: number;
  dead: boolean;
  removed: boolean;
  color?: unknown;
  vertexColor?: readonly [number, number, number, number];
}
export interface SceneryContext {
  handle(this: void, kind: string): Handle;
}
interface Region { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Map data supplies facts which Warcraft would read from its assets. */
export class Scenery {
  readonly doodads: DoodadState[];
  readonly destructables = new Map<Handle, DestructableState>();
  readonly fog: Record<string, unknown> = {};
  readonly water: Record<string, unknown> = {};
  readonly cameraInput = new Map<unknown, boolean>();
  readonly cameraSetups = new Map<Handle, number>();
  readonly cameraBlockers = new Map<Handle, boolean>();
  cameraType = 0;
  cameraAllowsHotkeyTargetLock = true;
  minShadowCastingPointLightCount = 0;
  cinematicEnabledDE = true;
  thematicMusicPauseOnFocusLost = false;
  thematicMusicAbsoluteVolume: number | undefined;
  cinematic: { model: string; x: number; y: number; z: number; rotation: number; elapsed: number; shots: readonly number[] } | undefined;
  preloadedCinematic: string | undefined;
  readonly hudScale: number;

  constructor(private readonly fixtures: SceneryFixtures = {}) {
    this.doodads = (fixtures.doodads ?? []).map(d => ({ ...d }));
    this.hudScale = fixtures.hudScale ?? 1;
  }

  tick(seconds: number): void {
    if (this.cinematic !== undefined) this.cinematic.elapsed = f32(this.cinematic.elapsed + seconds);
  }

  private shots(model: string): readonly number[] {
    const shots = this.fixtures.cinematics?.[model];
    if (shots === undefined) throw new Error(`cinematic ${model} needs a scenery.cinematics fixture`);
    return shots;
  }

  private currentShot(): number {
    const cinematic = this.cinematic;
    if (cinematic === undefined) return 0;
    let end = 0;
    for (let i = 0; i < cinematic.shots.length; i++) {
      end = f32(end + (cinematic.shots[i] ?? 0));
      if (cinematic.elapsed < end) return i;
    }
    return cinematic.shots.length;
  }

  private remaining(): number {
    const cinematic = this.cinematic;
    if (cinematic === undefined) return 0;
    let total = 0;
    for (const seconds of cinematic.shots) total = f32(total + seconds);
    return Math.max(0, f32(total - cinematic.elapsed));
  }

  private select(x: number, y: number, radius: number, id: number, nearestOnly: boolean): DoodadState[] {
    const selected: DoodadState[] = [];
    let nearest: DoodadState | undefined;
    let distance = radius * radius;
    for (const doodad of this.doodads) {
      const dx = doodad.x - x;
      const dy = doodad.y - y;
      const square = dx * dx + dy * dy;
      if (doodad.id !== id || square > radius * radius) continue;
      if (!nearestOnly) selected.push(doodad);
      else if (nearest === undefined || square < distance) { nearest = doodad; distance = square; }
    }
    if (nearestOnly && nearest !== undefined) selected.push(nearest);
    return selected;
  }

  private inRect(rect: Region, id: number): DoodadState[] {
    return this.doodads.filter(d => d.id === id && d.x >= rect.minX && d.x <= rect.maxX && d.y >= rect.minY && d.y <= rect.maxY);
  }

  behaviors(context: SceneryContext): Readonly<Record<string, NativeBehavior>> {
    const behaviors: Record<string, NativeBehavior> = {
      Rect: (minX: number, minY: number, maxX: number, maxY: number) => ({ ...context.handle("rect"), minX, minY, maxX, maxY }),
      SetTerrainFogExV: (style: number, zstart: number, zend: number, density: number, heightStart: number, heightEnd: number, linearStart: number, linearEnd: number, red: number, green: number, blue: number) => {
        this.fog.style = style; this.fog.zStart = zstart; this.fog.zEnd = zend; this.fog.density = density;
        this.fog.heightStart = heightStart; this.fog.heightEnd = heightEnd; this.fog.linearStart = linearStart; this.fog.linearEnd = linearEnd; this.fog.color = [red, green, blue];
      },
      BlzSetTerrainFogColor: (red: number, green: number, blue: number) => { this.fog.color = [red, green, blue]; },
      BlzSetMinShadowCastingPointLightCount: (count: number) => { this.minShadowCastingPointLightCount = count; },
      BlzGetMinShadowCastingPointLightCount: () => this.minShadowCastingPointLightCount,
      SetCameraFieldControlledByInput: (field: unknown, controlled: boolean) => { this.cameraInput.set(field, controlled); },
      GetCameraFieldControlledByInput: (field: unknown) => this.cameraInput.get(field) ?? false,
      BlzCameraSetCameraType: (type: number) => { this.cameraType = type; },
      BlzCameraGetCameraType: () => this.cameraType,
      BlzCameraSetupSetCameraType: (setup: Handle, type: number) => { this.cameraSetups.set(setup, type); },
      BlzCameraSetupGetCameraType: (setup: Handle) => this.cameraSetups.get(setup) ?? 0,
      AddCameraBlocker: (rect: Handle) => { this.cameraBlockers.set(rect, true); },
      EnableCameraBlocker: (rect: Handle, flag: boolean) => { this.cameraBlockers.set(rect, flag); },
      BlzGetCameraAllowsHotkeyTargetLock: () => this.cameraAllowsHotkeyTargetLock,
      BlzSetCameraAllowsHotkeyTargetLock: (allows: boolean) => { this.cameraAllowsHotkeyTargetLock = allows; },
      BlzGetHUDScale: () => this.hudScale,
      BlzPreloadModelCinematicGame: (model: string) => { this.shots(model); this.preloadedCinematic = model; return true; },
      BlzGetModelCinematicGameShotCount: () => this.cinematic?.shots.length ?? (this.preloadedCinematic === undefined ? 0 : this.shots(this.preloadedCinematic).length),
      BlzGetModelCinematicGameCurrentShot: () => this.currentShot(),
      BlzGetModelCinematicGameRemainingTime: () => this.remaining(),
      BlzPlayModelCinematicGameAtPosition: (model: string, x: number, y: number, z: number, rotation: number) => { this.cinematic = { model, x, y, z, rotation, elapsed: 0, shots: this.shots(model) }; },
      BlzSetCinematicEnabledDE: (enable: boolean) => { this.cinematicEnabledDE = enable; },
      BlzPauseThematicMusicOnFocusLost: (pause: boolean) => { this.thematicMusicPauseOnFocusLost = pause; },
      BlzSetThematicMusicAbsoluteVolume: (volume: number) => { this.thematicMusicAbsoluteVolume = volume; },
      SetHDWaterParams: (red: number, green: number, blue: number, override: boolean, vertexDisplacement: number, minOpacity: number, maxOpacity: number, reflectivity: number, emissivity: number, edgeSoftness: number, waveStrength: number) => {
        this.water.color = [red, green, blue]; this.water.override = override; this.water.vertexDisplacement = vertexDisplacement; this.water.minOpacity = minOpacity; this.water.maxOpacity = maxOpacity; this.water.reflectivity = reflectivity; this.water.emissivity = emissivity; this.water.edgeSoftness = edgeSoftness; this.water.waveStrength = waveStrength;
      },
      SetHDWaterParamsEx: (red: number, green: number, blue: number, override: boolean, vertexDisplacement: number, minOpacity: number, maxOpacity: number, reflectivity: number, emissivity: number, edgeSoftness: number, waveStrength: number, envMapStrength: number) => {
        this.water.color = [red, green, blue]; this.water.override = override; this.water.vertexDisplacement = vertexDisplacement; this.water.minOpacity = minOpacity; this.water.maxOpacity = maxOpacity; this.water.reflectivity = reflectivity; this.water.emissivity = emissivity; this.water.edgeSoftness = edgeSoftness; this.water.waveStrength = waveStrength; this.water.envMapStrength = envMapStrength;
      },
      BlzSetHDWaterColor: (red: number, green: number, blue: number) => { this.water.color = [red, green, blue]; },
      BlzIsTerrainPathableEx: (x: number, y: number, type: unknown) => {
        const cell = this.fixtures.pathing?.find(c => c.x === x && c.y === y && c.type === type);
        if (cell === undefined) throw new Error(`terrain pathing at ${x},${y} needs a scenery.pathing fixture`);
        return cell.blocked;
      },
      BlzGetNumDoodads: () => this.doodads.length,
      BlzSetSingleDoodadAnimation: (index: number, animation: string, random: boolean) => { const d = this.doodads[index]; if (d !== undefined) { d.animation = animation; d.animationRandom = random; } },
      SetDoodadAnimation: (x: number, y: number, radius: number, id: number, nearestOnly: boolean, animation: string, random: boolean) => { for (const d of this.select(x, y, radius, id, nearestOnly)) { d.animation = animation; d.animationRandom = random; } },
      SetDoodadAnimationRect: (rect: Region, id: number, animation: string, random: boolean) => { for (const d of this.inRect(rect, id)) { d.animation = animation; d.animationRandom = random; } },
      BlzSetSingleDoodadColor: (index: number, color: unknown) => { const d = this.doodads[index]; if (d !== undefined) d.color = color; },
      SetDoodadColor: (x: number, y: number, radius: number, id: number, nearestOnly: boolean, color: unknown) => { for (const d of this.select(x, y, radius, id, nearestOnly)) d.color = color; },
      SetDoodadColorRect: (rect: Region, id: number, color: unknown) => { for (const d of this.inRect(rect, id)) d.color = color; },
      SetDestructableColor: (d: Handle, color: unknown) => { const state = this.destructables.get(d); if (state !== undefined) state.color = color; },
      SetDestructableVertexColor: (d: Handle, red: number, green: number, blue: number, alpha: number) => { const state = this.destructables.get(d); if (state !== undefined) state.vertexColor = [red, green, blue, alpha]; },
    };
    const fogFields: Readonly<Record<string, string>> = { Style: "style", ZStart: "zStart", ZEnd: "zEnd", Density: "density", HeightStart: "heightStart", HeightEnd: "heightEnd", LinearStart: "linearStart", LinearEnd: "linearEnd", MaxLinearDensity: "maxLinearDensity", DrawOverSky: "drawOverSky" };
    for (const suffix of Object.keys(fogFields)) {
      const field = fogFields[suffix];
      if (field !== undefined) behaviors[`BlzSetTerrainFog${suffix}`] = (value: unknown) => { this.fog[field] = value; };
    }
    const waterFields = ["ColorOverride", "VertexDisplacement", "MinOpacity", "MaxOpacity", "Reflectivity", "Emissivity", "EdgeSoftness", "WaveStrength", "EnvMapStrength"];
    for (const suffix of waterFields) {
      const field = suffix === "ColorOverride" ? "override" : suffix.charAt(0).toLowerCase() + suffix.slice(1);
      behaviors[`BlzSetHDWater${suffix}`] = (value: unknown) => { this.water[field] = value; };
    }
    const doodadFields: Readonly<Record<string, keyof DoodadFixture>> = { X: "x", Y: "y", Z: "z", ScaleX: "scaleX", ScaleY: "scaleY", ScaleZ: "scaleZ", IsUsingModelAxes: "usingModelAxes", Yaw: "yaw", Pitch: "pitch", Roll: "roll", Variation: "variation", Id: "id" };
    for (const suffix of Object.keys(doodadFields)) {
      const field = doodadFields[suffix];
      if (field !== undefined) behaviors[`BlzGetDoodad${suffix}`] = (index: number) => this.doodads[index]?.[field] ?? (field === "usingModelAxes" ? false : 0);
    }
    for (const dead of [false, true]) for (const z of [false, true]) for (const skin of [false, true]) for (const orientation of [false, true]) for (const color of [false, true]) {
      if (!orientation && !color) continue;
      const name = `BlzCreate${dead ? "Dead" : ""}Destructable${z ? "Z" : ""}${skin ? "WithSkin" : ""}${orientation ? "PitchRoll" : ""}${color ? (skin ? "Color" : "WithColor") : ""}`;
      behaviors[name] = (...args: unknown[]) => {
        let offset = 3;
        const altitude = z ? args[offset++] as number : 0;
        const facing = args[offset++] as number;
        const roll = orientation ? args[offset++] as number : 0;
        const pitch = orientation ? args[offset++] as number : 0;
        const scale = args[offset++] as number;
        const variation = args[offset++] as number;
        const typeId = args[0] as number;
        const skinId = skin ? args[offset++] as number : typeId;
        const state: DestructableState = { ...context.handle("destructable"), typeId, skinId, x: args[1] as number, y: args[2] as number, z: altitude, facing, roll, pitch, scale, variation, dead, removed: false };
        if (color) state.color = args[offset];
        this.destructables.set(state, state);
        return state;
      };
    }
    return behaviors;
  }
}
