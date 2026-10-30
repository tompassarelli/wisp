import type { WindowView } from "./binding";

/** The render thread's series a probe reads: per-frame times in milliseconds, and flags that are 1 for each frame that counted. */
export const RENDER_SERIES = ["presentedMs", "drawMs", "parseMs", "inputToPresentMs", "missedPresents", "missedPresentsAfterLateScene", "lateScenes", "droppedSamples"] as const;

export type RenderSeriesName = typeof RENDER_SERIES[number];
export type RenderSeries = Readonly<Record<RenderSeriesName, readonly number[]>>;

export const renderSeriesLengths = (window: WindowView): Readonly<Record<RenderSeriesName, number>> =>
  Object.fromEntries(RENDER_SERIES.map((name) => [name, window.metric(name).length])) as Record<RenderSeriesName, number>;

/** The series' samples from the lengths taken at the start of the measured frames, to the end of the run so far. */
export const renderSeriesSince = (window: WindowView, from: Readonly<Record<RenderSeriesName, number>>, frames?: number): RenderSeries =>
  Object.fromEntries(RENDER_SERIES.map((name) => [name, Array.from(window.metric(name)).slice(from[name], frames === undefined ? undefined : from[name] + frames)])) as unknown as RenderSeries;

export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
