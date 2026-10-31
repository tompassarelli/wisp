import type { WindowView } from "./binding";
import { type Spread, spread } from "./stats";

/** The GPU's passes the render thread times, by the key the result gives each; `frame` spans the first pass's beginning to the last one's end. */
const GPU_PASSES = ["frame", "shadow", "reflection", "clouds", "sky", "scene", "post", "sprites", "ui", "counter"] as const;

type GpuPass = typeof GPU_PASSES[number];

const gpuSeries = (pass: GpuPass) => `gpu${pass[0]!.toUpperCase()}${pass.slice(1)}Ms` as `gpu${Capitalize<GpuPass>}Ms`;

/** The render thread's series a probe reads: per-frame times in milliseconds, and flags that are 1 for each frame that counted. The `gpu` series come back a few frames after the frame they time. */
export const RENDER_SERIES = [
  "presentedMs", "drawMs", "cpuEncodeMs", "parseMs", "inputToPresentMs", "missedPresents", "missedPresentsAfterLateScene", "lateScenes", "droppedSamples",
  ...GPU_PASSES.map(gpuSeries),
] as const;

export type RenderSeriesName = typeof RENDER_SERIES[number];
export type RenderSeries = Readonly<Record<RenderSeriesName, readonly number[]>>;

export const renderSeriesLengths = (window: WindowView): Readonly<Record<RenderSeriesName, number>> =>
  Object.fromEntries(RENDER_SERIES.map((name) => [name, window.metric(name).length])) as Record<RenderSeriesName, number>;

/** The series' samples from the lengths taken at the start of the measured frames, to the end of the run so far. */
export const renderSeriesSince = (window: WindowView, from: Readonly<Record<RenderSeriesName, number>>, frames?: number): RenderSeries =>
  Object.fromEntries(RENDER_SERIES.map((name) => [name, Array.from(window.metric(name)).slice(from[name], frames === undefined ? undefined : from[name] + frames)])) as unknown as RenderSeries;

export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * The GPU's time per pass that ran, from the window's timestamp queries, or why there is none: an adapter without timestamps
 * (`unavailable`, from the window's info) or a run whose stamps never came back gives `gpuPassMsAbsent` and no figures, never zeros.
 */
export const gpuReport = (series: (name: RenderSeriesName) => readonly number[], unavailable: string | undefined): { gpuPassMs: Partial<Record<GpuPass, Spread>> } | { gpuPassMsAbsent: string } => {
  if (unavailable !== undefined) return { gpuPassMsAbsent: unavailable };
  const timed = GPU_PASSES.map((pass) => [pass, series(gpuSeries(pass))] as const).filter(([, values]) => values.length > 0);
  if (timed.length === 0) return { gpuPassMsAbsent: "no frame's timestamps came back from the GPU" };
  return { gpuPassMs: Object.fromEntries(timed.map(([pass, values]) => [pass, spread(values)])) };
};
