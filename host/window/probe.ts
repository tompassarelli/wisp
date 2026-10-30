import { Effect, Schedule } from "effect";
import { RenderFailure } from "../render/headlessRender";
import { WAKE_FRAME, openNativeWindow } from "./binding";
import { type RenderSeries, RENDER_SERIES, renderSeriesSince, sum } from "./renderSeries";
import { spread, summed } from "./stats";
import { openSimPlayer } from "./simPlayer";
import type { NativeGameModule } from "./simProtocol";

const LATE_SCENES_BOUND = 6;
const BASELINE_POLL = "50 millis";

interface WindowFigures {
  readonly frames: number;
  readonly warmupFrames: number;
  readonly adapter: string;
  readonly backend: string;
  readonly presentMode: string;
  readonly desiredMaximumFrameLatency: number;
  readonly render: RenderSeries;
}

/** Every per-frame series a probe run measured, in milliseconds, before the report turns them into percentiles. */
export interface ProbeSamples extends WindowFigures {
  readonly wakeMs: readonly number[];
  readonly dispatchMs: readonly number[];
  readonly stepMs: readonly number[];
  readonly encodeMs: readonly number[];
  readonly readAssetMs: readonly number[];
}

/** Runs the game through the production player and window, stepped on a worker thread, for `warmupFrames + frames` frames and keeps the last `frames` of each series. */
export const measureWindow = (game: NativeGameModule, title: string, frames: number, warmupFrames: number) => Effect.scoped(Effect.gen(function*() {
  const sim = yield* openSimPlayer({
    title, width: 1280, height: 720, scripted: false, game, standalone: { frames: warmupFrames + frames },
    probe: { frames, warmupFrames },
  });
  const result = yield* sim.completed;
  const series = result.series as Record<string, number[]> & { render?: RenderSeries };
  const keep = (values: readonly number[] | undefined) => (values ?? []).slice(-frames);
  if (series.render === undefined) return yield* new RenderFailure({ cause: new Error("the run ended before its measured frames") });
  return {
    frames, warmupFrames, adapter: String(result.adapter), backend: String(result.backend), presentMode: String(result.presentMode),
    desiredMaximumFrameLatency: Number(result.desiredMaximumFrameLatency), render: series.render,
    wakeMs: keep(series.wakes), dispatchMs: keep(series.dispatches), stepMs: keep(series.steps), encodeMs: keep(series.encodes), readAssetMs: series.readAssets ?? [],
  } satisfies ProbeSamples;
}));

/** The figures the plan's first box asks for, from the render thread alone: the gated counts with their bounds, and the present-path times beside them. */
const renderReport = (render: RenderSeries) => {
  const counts = {
    missedPresents: sum(render.missedPresents), missedPresentsAfterLateScene: sum(render.missedPresentsAfterLateScene),
    lateScenes: sum(render.lateScenes), droppedSamples: sum(render.droppedSamples),
  };
  return {
    ...counts,
    gates: { missedPresents: counts.missedPresents === 0, lateScenes: counts.lateScenes <= LATE_SCENES_BOUND, droppedSamples: counts.droppedSamples === 0 },
    presentedMs: spread(render.presentedMs), inputToPresentMs: spread(render.inputToPresentMs), drawMs: spread(render.drawMs), parseMs: spread(render.parseMs),
  };
};

/**
 * The numbers the plan's first box asks for. `pauses` are the collector pauses by heap in the measured frames: the main thread's heap
 * holds the wake and the worker's heap runs the game, so both are reported as figures beside the gated counts.
 */
export function probeReport(samples: ProbeSamples, pauses: ReadonlyMap<string, readonly number[]>, mainHeap: string | undefined) {
  const { wakeMs, dispatchMs, stepMs, encodeMs, readAssetMs, render, ...rest } = samples;
  const main = mainHeap === undefined ? [] : pauses.get(mainHeap) ?? [];
  const worker = [...pauses].filter(([heap]) => heap !== mainHeap).flatMap(([, values]) => values);
  return {
    ...rest,
    ...renderReport(render),
    wakeMs: spread(wakeMs), dispatchMs: spread(dispatchMs), stepMs: spread(stepMs),
    sceneMs: spread(summed(encodeMs, render.parseMs)), encodeMs: spread(encodeMs),
    gcPauseMs: { ...spread(main), count: main.length },
    workerGcPauseMs: { ...spread(worker), count: worker.length },
    readAssetMs: spread(readAssetMs),
  };
}

/** Drives the render loop with no game: Rust submits a canned scene at each sample point, so the counts are the display path's own floor. */
export const measureBaseline = (title: string, frames: number, warmupFrames: number) => Effect.scoped(Effect.gen(function*() {
  const closed = Promise.withResolvers<void>();
  const window = yield* Effect.acquireRelease(
    Effect.try({
      try: () => openNativeWindow({ title, width: 1280, height: 720, onWake: (kind) => { if (kind !== WAKE_FRAME) closed.resolve(); } }),
      catch: (cause) => new RenderFailure({ cause }),
    }),
    (open) => Effect.sync(() => open.close()),
  );
  window.startBaseline();
  const wanted = warmupFrames + frames;
  const framesTaken = Effect.sync(() => window.metric("lateScenes").length);
  yield* framesTaken.pipe(Effect.repeat({ schedule: Schedule.spaced(BASELINE_POLL), until: (taken) => taken >= wanted }), Effect.raceFirst(Effect.promise(() => closed.promise)));
  if ((yield* framesTaken) < wanted) return yield* new RenderFailure({ cause: new Error(window.error() ?? "the window closed before the baseline finished") });
  const render = renderSeriesSince(window, Object.fromEntries(RENDER_SERIES.map((name) => [name, warmupFrames])) as Record<(typeof RENDER_SERIES)[number], number>, frames);
  return { baseline: true, frames, warmupFrames, ...window.info(), ...renderReport(render) };
}));
