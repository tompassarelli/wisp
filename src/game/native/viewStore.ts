import { FRAMES_PER_SECOND } from "./frameRate";

const BLEND_MODES = ["BLEND_MODE_NONE", "BLEND_MODE_DONT_CARE", "BLEND_MODE_KEYALPHA", "BLEND_MODE_BLEND", "BLEND_MODE_ADDITIVE", "BLEND_MODE_MODULATE", "BLEND_MODE_MODULATE_2X"];

const CAMERA_FIELDS = ["CAMERA_FIELD_TARGET_DISTANCE", "CAMERA_FIELD_FARZ", "CAMERA_FIELD_ANGLE_OF_ATTACK", "CAMERA_FIELD_FIELD_OF_VIEW", "CAMERA_FIELD_ROLL", "CAMERA_FIELD_ROTATION", "CAMERA_FIELD_ZOFFSET", "CAMERA_FIELD_NEARZ", "CAMERA_FIELD_LOCAL_PITCH", "CAMERA_FIELD_LOCAL_YAW", "CAMERA_FIELD_LOCAL_ROLL", "CAMERA_FIELD_DEPTH_OF_FIELD_DISTANCE", "CAMERA_FIELD_DEPTH_OF_FIELD_SCALE", "CAMERA_FIELD_ZABSOLUTE"];

export interface CineFilterPose {
  readonly texture: string;

  readonly blendMode: string;
  readonly texMapFlags: unknown;

  readonly color: readonly [number, number, number, number];

  readonly uv: readonly [number, number, number, number];
}

export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly fields: Readonly<Record<string, number>>;
}

/** A stage's sky as the native window paints it; colours are 0 to 1, angles degrees. */
export interface SkyLook {
  readonly zenith: readonly [number, number, number];
  readonly cover: number;
  readonly sunAzimuth: number;
  readonly sunElevation: number;
  readonly sun: readonly [number, number, number];
  readonly stars: number;
  readonly glow: number;
}

export interface Environment {
  sky: string;
  skyLook?: SkyLook;
  skyVisible: boolean;
  terrainVisible: boolean;

  dayNight: { terrain: string; unit: string };

  timeOfDay: number;
}

type Quad = [number, number, number, number];

interface CineFilter {
  texture: string;
  blendMode: string;
  texMapFlags: unknown;
  startColor: Quad;
  endColor: Quad;
  startUV: Quad;
  endUV: Quad;
  duration: number;

  shown: number | undefined;
}

const cameraFieldName = (field: unknown): string => {
  if (typeof field === "number") return CAMERA_FIELDS[field] ?? String(field);
  return String(field);
};

/** What a player sees of the camera, the fog, the sky and the cinematic filter. Calls that set a mode with no look of their own (camera bounds and smoothing, a pan, fog and fog-mask switches, the time-of-day rate) are logged by the family module and kept nowhere. */
export class View {
  readonly fog: Record<string, unknown> = {};
  readonly environment: Environment = { sky: "", skyVisible: true, terrainVisible: true, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 };
  minShadowCastingPointLightCount = 0;
  private cameraX = 0;
  private cameraY = 0;
  private readonly cameraFields: Record<string, number> = {};
  private readonly cineFilter: CineFilter = { texture: "", blendMode: "BLEND_MODE_NONE", texMapFlags: undefined, startColor: [255, 255, 255, 255], endColor: [255, 255, 255, 255], startUV: [0, 0, 1, 1], endUV: [0, 0, 1, 1], duration: 0, shown: undefined };

  constructor(private readonly frame: (this: void) => number) {}

  cineFilterPose(): CineFilterPose | undefined {
    const filter = this.cineFilter;
    if (filter.shown === undefined) return undefined;
    const share = filter.duration <= 0 ? 1 : Math.min(1, (this.frame() - filter.shown) / FRAMES_PER_SECOND / filter.duration);
    const mix = (from: readonly number[], to: readonly number[]): Quad =>
      [0, 1, 2, 3].map((i) => (from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * share) as Quad;
    return { texture: filter.texture, blendMode: filter.blendMode, texMapFlags: filter.texMapFlags, color: mix(filter.startColor, filter.endColor), uv: mix(filter.startUV, filter.endUV) };
  }

  cameraPose(): CameraPose {
    return { x: this.cameraX, y: this.cameraY, fields: { ...this.cameraFields } };
  }

  setCameraPosition(x: number, y: number): void {
    this.cameraX = x;
    this.cameraY = y;
  }

  targetX(): number { return this.cameraX; }

  targetY(): number { return this.cameraY; }

  setCameraField(field: unknown, value: number): void {
    this.cameraFields[cameraFieldName(field)] = value;
  }

  cameraField(field: unknown): number {
    return this.cameraFields[cameraFieldName(field)] ?? 0;
  }

  setFog(style: number, start: number, end: number, density: number, red: number, green: number, blue: number): void {
    this.fog.style = style; this.fog.zStart = start; this.fog.zEnd = end; this.fog.density = density; this.fog.color = [red, green, blue];
  }

  setFogHeight(style: number, start: number, end: number, density: number, heightStart: number, heightEnd: number, linearStart: number, linearEnd: number, red: number, green: number, blue: number): void {
    this.fog.style = style; this.fog.zStart = start; this.fog.zEnd = end; this.fog.density = density;
    this.fog.heightStart = heightStart; this.fog.heightEnd = heightEnd; this.fog.linearStart = linearStart; this.fog.linearEnd = linearEnd; this.fog.color = [red, green, blue];
  }

  resetFog(): void {
    for (const field of Object.keys(this.fog)) delete this.fog[field];
  }

  setFilterTexture(texture: string): void { this.cineFilter.texture = texture; }

  setFilterBlendMode(mode: unknown): void { this.cineFilter.blendMode = typeof mode === "number" ? BLEND_MODES[mode] ?? "BLEND_MODE_NONE" : String(mode); }

  setFilterTexMapFlags(flags: unknown): void { this.cineFilter.texMapFlags = flags; }

  setFilterStartUV(minU: number, minV: number, maxU: number, maxV: number): void { this.cineFilter.startUV = [minU, minV, maxU, maxV]; }

  setFilterEndUV(minU: number, minV: number, maxU: number, maxV: number): void { this.cineFilter.endUV = [minU, minV, maxU, maxV]; }

  setFilterStartColor(red: number, green: number, blue: number, alpha: number): void { this.cineFilter.startColor = [red, green, blue, alpha]; }

  setFilterEndColor(red: number, green: number, blue: number, alpha: number): void { this.cineFilter.endColor = [red, green, blue, alpha]; }

  setFilterDuration(duration: number): void { this.cineFilter.duration = duration; }

  showFilter(visible: boolean): void { this.cineFilter.shown = visible ? this.frame() : undefined; }

  filterShown(): boolean { return this.cineFilter.shown !== undefined; }
}
