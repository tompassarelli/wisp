import type { CameraPose, CineFilterPose, NativeBehavior } from "../clientTypes";
import { FRAMES_PER_SECOND } from "../frameRate";
import { describeValue } from "../jassFormat";
import type { Scenery } from "../warcraft3Scenery";

const BLEND_MODES = ["BLEND_MODE_NONE", "BLEND_MODE_DONT_CARE", "BLEND_MODE_KEYALPHA", "BLEND_MODE_BLEND", "BLEND_MODE_ADDITIVE", "BLEND_MODE_MODULATE", "BLEND_MODE_MODULATE_2X"];

const CAMERA_FIELDS = ["CAMERA_FIELD_TARGET_DISTANCE", "CAMERA_FIELD_FARZ", "CAMERA_FIELD_ANGLE_OF_ATTACK", "CAMERA_FIELD_FIELD_OF_VIEW", "CAMERA_FIELD_ROLL", "CAMERA_FIELD_ROTATION", "CAMERA_FIELD_ZOFFSET", "CAMERA_FIELD_NEARZ", "CAMERA_FIELD_LOCAL_PITCH", "CAMERA_FIELD_LOCAL_YAW", "CAMERA_FIELD_LOCAL_ROLL", "CAMERA_FIELD_DEPTH_OF_FIELD_DISTANCE", "CAMERA_FIELD_DEPTH_OF_FIELD_SCALE", "CAMERA_FIELD_ZABSOLUTE"];

interface CineFilter {
  texture: string;
  blendMode: string;
  texMapFlags: unknown;
  startColor: [number, number, number, number];
  endColor: [number, number, number, number];
  startUV: [number, number, number, number];
  endUV: [number, number, number, number];
  duration: number;

  shown: number | undefined;
}

const cameraField = (field: unknown): string => {
  if (typeof field === "number") return CAMERA_FIELDS[field] ?? describeValue(field);
  if (typeof field === "string") return field;
  return describeValue(field);
};

export class CameraCine {
  private cameraX = 0;
  private cameraY = 0;
  private readonly cameraFields: Record<string, number> = {};
  private readonly cineFilter: CineFilter = { texture: "", blendMode: "BLEND_MODE_NONE", texMapFlags: undefined, startColor: [255, 255, 255, 255], endColor: [255, 255, 255, 255], startUV: [0, 0, 1, 1], endUV: [0, 0, 1, 1], duration: 0, shown: undefined };

  constructor(private readonly scenery: Scenery, private readonly frame: (this: void) => number) {}

  cineFilterPose(): CineFilterPose | undefined {
    const filter = this.cineFilter;
    if (filter.shown === undefined) return undefined;
    const share = filter.duration <= 0 ? 1 : Math.min(1, (this.frame() - filter.shown) / FRAMES_PER_SECOND / filter.duration);
    const mix = (from: readonly number[], to: readonly number[]): [number, number, number, number] =>
      [0, 1, 2, 3].map((i) => (from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * share) as [number, number, number, number];
    return { texture: filter.texture, blendMode: filter.blendMode, texMapFlags: filter.texMapFlags, color: mix(filter.startColor, filter.endColor), uv: mix(filter.startUV, filter.endUV) };
  }

  cameraPose(): CameraPose {
    return { x: this.cameraX, y: this.cameraY, fields: { ...this.cameraFields } };
  }

  behaviors(): Readonly<Record<string, NativeBehavior>> {
    return {
      SetCameraPosition: (x: number, y: number) => {
        this.cameraX = x;
        this.cameraY = y;
      },
      GetCameraTargetPositionX: () => this.cameraX,
      SetCameraTargetController: () => { this.scenery.cameraAllowsHotkeyTargetLock = false; },
      SetCameraOrientController: () => { this.scenery.cameraAllowsHotkeyTargetLock = false; },
      SetCameraField: (field: unknown, value: number) => {
        this.cameraFields[cameraField(field)] = value;
      },
      GetCameraField: (field: unknown) => this.cameraFields[cameraField(field)] ?? 0,
      SetCineFilterTexture: (texture: string) => { this.cineFilter.texture = texture; },
      SetCineFilterBlendMode: (mode: unknown) => { this.cineFilter.blendMode = typeof mode === "number" ? BLEND_MODES[mode] ?? "BLEND_MODE_NONE" : String(mode); },
      SetCineFilterTexMapFlags: (flags: unknown) => { this.cineFilter.texMapFlags = flags; },
      SetCineFilterStartUV: (minU: number, minV: number, maxU: number, maxV: number) => { this.cineFilter.startUV = [minU, minV, maxU, maxV]; },
      SetCineFilterEndUV: (minU: number, minV: number, maxU: number, maxV: number) => { this.cineFilter.endUV = [minU, minV, maxU, maxV]; },
      SetCineFilterStartColor: (red: number, green: number, blue: number, alpha: number) => { this.cineFilter.startColor = [red, green, blue, alpha]; },
      SetCineFilterEndColor: (red: number, green: number, blue: number, alpha: number) => { this.cineFilter.endColor = [red, green, blue, alpha]; },
      SetCineFilterDuration: (duration: number) => { this.cineFilter.duration = duration; },
      DisplayCineFilter: (flag: boolean) => { this.cineFilter.shown = flag ? this.frame() : undefined; },
      IsCineFilterDisplayed: () => this.cineFilter.shown !== undefined,
    };
  }
}
