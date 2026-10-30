import { f32 } from "../../sim/f32";
import type { Handle, HandleFactory } from "./types";

export interface LightningPose {
  readonly handle: Handle;
  readonly codeName: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly color: readonly [number, number, number, number];
}

interface Lightning {
  readonly handle: Handle;
  readonly codeName: string;
  from: [number, number, number];
  to: [number, number, number];
  color: [number, number, number, number];
}

export class Lightnings {
  private readonly bolts = new Map<Handle, Lightning>();

  constructor(private readonly handle: HandleFactory) {}

  add(codeName: string, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Handle {
    const handle = this.handle("lightning");
    this.bolts.set(handle, { handle, codeName, from: [f32(x1), f32(y1), f32(z1)], to: [f32(x2), f32(y2), f32(z2)], color: [1, 1, 1, 1] });
    return handle;
  }

  move(bolt: Handle, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): boolean {
    const found = this.bolts.get(bolt);
    if (found === undefined) return false;
    found.from = [f32(x1), f32(y1), f32(z1)];
    found.to = [f32(x2), f32(y2), f32(z2)];
    return true;
  }

  destroy(bolt: Handle): boolean {
    return this.bolts.delete(bolt);
  }

  setColor(bolt: Handle, red: number, green: number, blue: number, alpha: number): boolean {
    const found = this.bolts.get(bolt);
    if (found === undefined) return false;
    found.color = [f32(red), f32(green), f32(blue), f32(alpha)];
    return true;
  }

  channel(bolt: Handle, index: number): number {
    return this.bolts.get(bolt)?.color[index] ?? 0;
  }

  poses(): LightningPose[] {
    return [...this.bolts.values()].map(found => ({ handle: found.handle, codeName: found.codeName, from: [...found.from], to: [...found.to], color: [...found.color] }));
  }
}
