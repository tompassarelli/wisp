import { f32 } from "../sim/f32";
import type { Handle } from "./client";

/** TextTagSpeed2Velocity's scale: a velocity of 0.071 moves a tag 128 world units a second. */
const WORLD_UNITS_PER_VELOCITY = 128 / f32(0.071);

interface TextTag {
  readonly handle: Handle;
  text: string;

  height: number;
  x: number;
  y: number;
  z: number;
  color: [number, number, number, number];
  xVelocity: number;
  yVelocity: number;
  visible: boolean;
  suspended: boolean;
  permanent: boolean;
  age: number;
  lifespan: number;
  fadepoint: number;
}

export interface TextTagPose {
  readonly handle: Handle;
  readonly text: string;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: readonly [number, number, number, number];
}

export interface TextTagContext {
  handle(this: void, kind: string): Handle;

  unitPosition(this: void, unit: unknown): { readonly x: number; readonly y: number; readonly z: number } | undefined;
}

export class TextTags {
  private readonly tags = new Map<Handle, TextTag>();

  behaviors(context: TextTagContext): Record<string, (...args: never[]) => unknown> {
    const tag = (value: unknown) => this.tags.get(value as Handle);
    return {
      CreateTextTag: () => {
        const handle = context.handle("texttag");
        this.tags.set(handle, { handle, text: "", height: 0, x: 0, y: 0, z: 0, color: [255, 255, 255, 255], xVelocity: 0, yVelocity: 0,
          visible: true, suspended: false, permanent: true, age: 0, lifespan: 0, fadepoint: 0 });
        return handle;
      },
      DestroyTextTag: (t: unknown) => { this.tags.delete(t as Handle); },
      SetTextTagText: (t: unknown, text: string, height: number) => {
        const found = tag(t);
        if (found !== undefined) { found.text = text; found.height = height; }
      },
      SetTextTagPos: (t: unknown, x: number, y: number, heightOffset: number) => {
        const found = tag(t);
        if (found !== undefined) { found.x = x; found.y = y; found.z = heightOffset; }
      },
      SetTextTagPosUnit: (t: unknown, unit: unknown, heightOffset: number) => {
        const found = tag(t), at = context.unitPosition(unit);
        if (found !== undefined && at !== undefined) { found.x = at.x; found.y = at.y; found.z = at.z + heightOffset; }
      },
      SetTextTagColor: (t: unknown, red: number, green: number, blue: number, alpha: number) => {
        const found = tag(t);
        if (found !== undefined) found.color = [red, green, blue, alpha];
      },
      SetTextTagVelocity: (t: unknown, xVelocity: number, yVelocity: number) => {
        const found = tag(t);
        if (found !== undefined) { found.xVelocity = xVelocity; found.yVelocity = yVelocity; }
      },
      SetTextTagVisibility: (t: unknown, visible: boolean) => { const found = tag(t); if (found !== undefined) found.visible = visible; },
      SetTextTagSuspended: (t: unknown, suspended: boolean) => { const found = tag(t); if (found !== undefined) found.suspended = suspended; },
      SetTextTagPermanent: (t: unknown, permanent: boolean) => { const found = tag(t); if (found !== undefined) found.permanent = permanent; },
      SetTextTagAge: (t: unknown, age: number) => { const found = tag(t); if (found !== undefined) found.age = age; },
      SetTextTagLifespan: (t: unknown, lifespan: number) => { const found = tag(t); if (found !== undefined) found.lifespan = lifespan; },
      SetTextTagFadepoint: (t: unknown, fadepoint: number) => { const found = tag(t); if (found !== undefined) found.fadepoint = fadepoint; },
    };
  }

  tick(seconds: number): void {
    for (const found of this.tags.values()) {
      if (found.suspended) continue;
      found.x += found.xVelocity * WORLD_UNITS_PER_VELOCITY * seconds;
      found.y += found.yVelocity * WORLD_UNITS_PER_VELOCITY * seconds;
      found.age += seconds;
      if (!found.permanent && found.age >= found.lifespan) this.tags.delete(found.handle);
    }
  }

  poses(): TextTagPose[] {
    const poses: TextTagPose[] = [];
    for (const found of this.tags.values()) {
      if (!found.visible || found.text === "") continue;
      const fading = !found.permanent && found.age > found.fadepoint && found.lifespan > found.fadepoint;
      const share = fading ? Math.max(0, 1 - (found.age - found.fadepoint) / (found.lifespan - found.fadepoint)) : 1;
      poses.push({ handle: found.handle, text: found.text, height: found.height, x: found.x, y: found.y, z: found.z,
        color: [found.color[0], found.color[1], found.color[2], Math.round(found.color[3] * share)] });
    }
    return poses;
  }
}
