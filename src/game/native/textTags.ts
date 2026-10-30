import { f32 } from "../../sim/f32";
import type { Handle, HandleFactory } from "./types";

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

export class TextTags {
  private readonly tags = new Map<Handle, TextTag>();

  constructor(private readonly handle: HandleFactory) {}

  create(): Handle {
    const handle = this.handle("texttag");
    this.tags.set(handle, { handle, text: "", height: 0, x: 0, y: 0, z: 0, color: [255, 255, 255, 255], xVelocity: 0, yVelocity: 0,
      visible: true, suspended: false, permanent: true, age: 0, lifespan: 0, fadepoint: 0 });
    return handle;
  }

  destroy(tag: Handle): void { this.tags.delete(tag); }

  setText(tag: Handle, text: string, height: number): void {
    const found = this.tags.get(tag);
    if (found !== undefined) { found.text = text; found.height = height; }
  }

  setPosition(tag: Handle, x: number, y: number, z: number): void {
    const found = this.tags.get(tag);
    if (found !== undefined) { found.x = x; found.y = y; found.z = z; }
  }

  setColor(tag: Handle, red: number, green: number, blue: number, alpha: number): void {
    const found = this.tags.get(tag);
    if (found !== undefined) found.color = [red, green, blue, alpha];
  }

  setVelocity(tag: Handle, xVelocity: number, yVelocity: number): void {
    const found = this.tags.get(tag);
    if (found !== undefined) { found.xVelocity = xVelocity; found.yVelocity = yVelocity; }
  }

  setVisible(tag: Handle, visible: boolean): void { const found = this.tags.get(tag); if (found !== undefined) found.visible = visible; }
  setSuspended(tag: Handle, suspended: boolean): void { const found = this.tags.get(tag); if (found !== undefined) found.suspended = suspended; }
  setPermanent(tag: Handle, permanent: boolean): void { const found = this.tags.get(tag); if (found !== undefined) found.permanent = permanent; }
  setAge(tag: Handle, age: number): void { const found = this.tags.get(tag); if (found !== undefined) found.age = age; }
  setLifespan(tag: Handle, lifespan: number): void { const found = this.tags.get(tag); if (found !== undefined) found.lifespan = lifespan; }
  setFadepoint(tag: Handle, fadepoint: number): void { const found = this.tags.get(tag); if (found !== undefined) found.fadepoint = fadepoint; }

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
