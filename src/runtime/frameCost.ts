import { floorDiv, floorMod } from "../sim/intMath";

export const frameCostFile = (slot: number, prefix = "wisp") => `${prefix}-perf-p${slot}.txt`;

export interface Spread {
  readonly median: number;
  readonly mean: number;
  readonly max: number;
}

export interface FrameWindow {
  readonly frames: number;

  readonly lua: Spread | undefined;

  readonly natives: Spread;

  readonly catchUp: Spread;
}

export function spread(values: readonly number[], count: number): Spread {
  if (count <= 0) return { median: 0, mean: 0, max: 0 };
  const sorted: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index++) {
    const value = values[index] ?? 0;
    sorted.push(value);
    total += value;
  }
  sorted.sort((left, right) => left - right);
  const middle = floorDiv(count, 2);
  const median = floorMod(count, 2) === 1 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return { median, mean: total / count, max: sorted[count - 1] ?? 0 };
}

export function reportNumber(value: number): string {
  const hundredths = Math.floor(value * 100 + 0.5);
  const whole = floorDiv(hundredths, 100);
  const rest = floorMod(hundredths, 100);
  if (rest === 0) return `${whole}`;
  return rest < 10 ? `${whole}.0${rest}` : `${whole}.${rest}`;
}

const spreadText = ({ median, mean, max }: Spread) => `${reportNumber(median)}/${reportNumber(mean)}/${reportNumber(max)}`;

export const frameCostHeading = (version: number, previous: number, clockStep: number) =>
  `frame cost v${version} after v${previous} clock=${reportNumber(clockStep)}`;

export const frameWindowLine = (label: string, window: FrameWindow) =>
  `${label} frames=${window.frames} lua=${window.lua === undefined ? "none" : spreadText(window.lua)} natives=${spreadText(window.natives)} catchup=${spreadText(window.catchUp)}`;
