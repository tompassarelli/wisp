// Frame-cost reports: what the frame meter (wisp:src/platform/frameMeter.ts)
// writes after each hot reload and `wisp hot --watch` and `wisp dev` read
// (wisp:docs/frame-cost.md). Shared by map code and host tools.
import { floorDiv, floorMod } from "../sim/intMath";

/** The report a client writes once the version it runs has played a window of frames. */
export const frameCostFile = (slot: number, prefix = "wisp") => `${prefix}-perf-p${slot}.txt`;

/** A value's median, mean and maximum over a window of frames. */
export interface Spread {
  readonly median: number;
  readonly mean: number;
  readonly max: number;
}

/** What a window of frames cost per frame. */
export interface FrameWindow {
  readonly frames: number;
  /** Lua time in microseconds; undefined where the game has no clock. */
  readonly lua: Spread | undefined;
  /** Calls to Warcraft's functions: every global function whose name starts with a capital letter. */
  readonly natives: Spread;
  /** Simulation frames the game advanced. */
  readonly catchUp: Spread;
}

/** The median, mean and maximum of the first `count` values; zeros for none. */
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

/** A non-negative number as reports write it, rounded to two decimals, alike in Lua and JavaScript. */
export function reportNumber(value: number): string {
  const hundredths = Math.floor(value * 100 + 0.5);
  const whole = floorDiv(hundredths, 100);
  const rest = floorMod(hundredths, 100);
  if (rest === 0) return `${whole}`;
  return rest < 10 ? `${whole}.0${rest}` : `${whole}.${rest}`;
}

const spreadText = ({ median, mean, max }: Spread) => `${reportNumber(median)}/${reportNumber(mean)}/${reportNumber(max)}`;

/** The report's first line: the version measured after a reload, the one before it, and the clock's step in microseconds (0 without a clock). */
export const frameCostHeading = (version: number, previous: number, clockStep: number) =>
  `frame cost v${version} after v${previous} clock=${reportNumber(clockStep)}`;

/** One window's line, `before` or `after`: its frames, then each value's median/mean/max per frame. */
export const frameWindowLine = (label: string, window: FrameWindow) =>
  `${label} frames=${window.frames} lua=${window.lua === undefined ? "none" : spreadText(window.lua)} natives=${spreadText(window.natives)} catchup=${spreadText(window.catchUp)}`;
