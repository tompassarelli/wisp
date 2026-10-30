import { Effect } from "effect";
import { spread, summed } from "./stats";
import { openSimPlayer } from "./simPlayer";
import type { NativeGameModule } from "./simProtocol";

/** Every per-frame series a probe run measured, in milliseconds, before the report turns them into percentiles. */
export interface ProbeSamples {
  readonly frames: number;
  readonly warmupFrames: number;
  readonly adapter: string;
  readonly backend: string;
  readonly presentMode: string;
  readonly desiredMaximumFrameLatency: number;
  readonly missedScenes: number;
  readonly wakeMs: readonly number[];
  readonly dispatchMs: readonly number[];
  readonly stepMs: readonly number[];
  readonly encodeMs: readonly number[];
  readonly parseMs: readonly number[];
  readonly readAssetMs: readonly number[];
  readonly presentedMs: readonly number[];
  readonly drawMs: readonly number[];
  readonly sampleToPresentMs: readonly number[];
}

/** Runs the game through the production player and window, stepped on a worker thread, for `warmupFrames + frames` frames and keeps the last `frames` of each series. */
export const measureWindow = (game: NativeGameModule, title: string, frames: number, warmupFrames: number) => Effect.scoped(Effect.gen(function*() {
  const sim = yield* openSimPlayer({
    title, width: 1280, height: 720, scripted: false, game, standalone: { frames: warmupFrames + frames },
    probe: { frames, warmupFrames },
  });
  const result = yield* sim.completed;
  const series = result.series as Record<string, number[]>;
  const keep = (values: readonly number[] | undefined) => (values ?? []).slice(-frames);
  return {
    frames, warmupFrames, adapter: String(result.adapter), backend: String(result.backend), presentMode: String(result.presentMode),
    desiredMaximumFrameLatency: Number(result.desiredMaximumFrameLatency), missedScenes: Number(result.missedScenes),
    wakeMs: keep(series.wakes), dispatchMs: keep(series.dispatches), stepMs: keep(series.steps), encodeMs: keep(series.encodes), parseMs: keep(series.parse),
    readAssetMs: series.readAssets ?? [], presentedMs: keep(series.presented), drawMs: keep(series.draw), sampleToPresentMs: keep(series.sampleToPresent),
  } satisfies ProbeSamples;
}));

/**
 * The numbers the plan's first box asks for. `pauses` are the collector pauses by heap in the measured frames: the main thread's heap
 * answers the wake, so its max is the bound, and the worker's heap runs the game, so its pauses are reported beside it.
 */
export function probeReport(samples: ProbeSamples, pauses: ReadonlyMap<string, readonly number[]>, mainHeap: string | undefined) {
  const { wakeMs, dispatchMs, stepMs, encodeMs, parseMs, readAssetMs, presentedMs, drawMs, sampleToPresentMs, ...rest } = samples;
  const main = mainHeap === undefined ? [] : pauses.get(mainHeap) ?? [];
  const worker = [...pauses].filter(([heap]) => heap !== mainHeap).flatMap(([, values]) => values);
  return {
    ...rest,
    wakeMs: spread(wakeMs), dispatchMs: spread(dispatchMs), stepMs: spread(stepMs),
    sceneMs: spread(summed(encodeMs, parseMs)), encodeMs: spread(encodeMs), parseMs: spread(parseMs),
    gcPauseMs: { ...spread(main), count: main.length },
    workerGcPauseMs: { ...spread(worker), count: worker.length },
    readAssetMs: spread(readAssetMs), presentedMs: spread(presentedMs), drawMs: spread(drawMs), sampleToPresentMs: spread(sampleToPresentMs),
  };
}

