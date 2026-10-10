import { f32 } from "../sim/f32";
import type { Handle } from "./client";

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

  behaviors(context: { handle(this: void, kind: string): Handle }): Record<string, (...args: never[]) => unknown> {
    const bolt = (value: unknown) => this.bolts.get(value as Handle);
    const add = (codeName: string, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      const handle = context.handle("lightning");
      this.bolts.set(handle, { handle, codeName, from: [f32(x1), f32(y1), f32(z1)], to: [f32(x2), f32(y2), f32(z2)], color: [1, 1, 1, 1] });
      return handle;
    };
    const move = (value: unknown, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      const found = bolt(value);
      if (found === undefined) return false;
      found.from = [f32(x1), f32(y1), f32(z1)];
      found.to = [f32(x2), f32(y2), f32(z2)];
      return true;
    };
    const channel = (index: number) => (value: unknown) => bolt(value)?.color[index] ?? 0;
    return {
      AddLightning: (codeName: string, _visible: boolean, x1: number, y1: number, x2: number, y2: number) => add(codeName, x1, y1, 0, x2, y2, 0),
      AddLightningEx: (codeName: string, _visible: boolean, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => add(codeName, x1, y1, z1, x2, y2, z2),
      DestroyLightning: (value: unknown) => this.bolts.delete(value as Handle),
      MoveLightning: (value: unknown, _visible: boolean, x1: number, y1: number, x2: number, y2: number) => move(value, x1, y1, 0, x2, y2, 0),
      MoveLightningEx: (value: unknown, _visible: boolean, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => move(value, x1, y1, z1, x2, y2, z2),
      SetLightningColor: (value: unknown, red: number, green: number, blue: number, alpha: number) => {
        const found = bolt(value);
        if (found === undefined) return false;
        found.color = [f32(red), f32(green), f32(blue), f32(alpha)];
        return true;
      },
      GetLightningColorR: channel(0),
      GetLightningColorG: channel(1),
      GetLightningColorB: channel(2),
      GetLightningColorA: channel(3),
    };
  }

  poses(): LightningPose[] {
    return [...this.bolts.values()].map(found => ({ handle: found.handle, codeName: found.codeName, from: [...found.from], to: [...found.to], color: [...found.color] }));
  }
}
