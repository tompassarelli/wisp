import { floorDiv, floorMod } from "../sim/intMath";
import type { Handle } from "./clientTypes";

export interface WeatherPose {
  readonly handle: Handle;
  readonly id: string;
  readonly rect: readonly [number, number, number, number];
}

interface Weather {
  readonly handle: Handle;
  readonly id: string;
  readonly rect: readonly [number, number, number, number];
  enabled: boolean;
}

interface Region { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

const fourCC = (id: number): string => [24, 16, 8, 0].map(shift => String.fromCharCode(floorMod(floorDiv(id, 2 ** shift), 256))).join("");

/** The weather effects a map adds over a rect: each starts enabled, and only an enabled one reaches the scene. */
export class Weathers {
  private readonly effects = new Map<Handle, Weather>();

  behaviors(context: { handle(this: void, kind: string): Handle }): Record<string, (...args: never[]) => unknown> {
    return {
      AddWeatherEffect: (rect: Region, id: number) => {
        const handle = context.handle("weathereffect");
        this.effects.set(handle, { handle, id: fourCC(id), rect: [rect.minX, rect.minY, rect.maxX, rect.maxY], enabled: true });
        return handle;
      },
      RemoveWeatherEffect: (value: unknown) => { this.effects.delete(value as Handle); },
      EnableWeatherEffect: (value: unknown, enable: boolean) => {
        const found = this.effects.get(value as Handle);
        if (found !== undefined) found.enabled = enable;
      },
    };
  }

  poses(): WeatherPose[] {
    return [...this.effects.values()].filter(found => found.enabled).map(found => ({ handle: found.handle, id: found.id, rect: found.rect }));
  }
}
