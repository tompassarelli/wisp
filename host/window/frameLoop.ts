import { Effect } from "effect";
import type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";
import type { InputSample, WindowView } from "./binding";
import { spread } from "./stats";

/** What `openStandalone` gives a window that drives the session itself: the scene before the first step, one step, and the end of the run. */
export interface NativePlayer {
  prepare(): { readonly models: readonly string[]; readonly step: number };
  advance(input: StandaloneInput): StandaloneFrame;
  finish(result: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface FrameLoopOptions {
  readonly scripted: boolean;
  /** Milliseconds from starting the player to its first frame, reported as `startupMs`. */
  readonly startupMs: number;
  /** Called once per finished frame with the count so far. */
  readonly afterFrame?: ((count: number) => void) | undefined;
  /** Fields added to the result, such as the raw series a probe reads. */
  readonly extraResult?: ((series: FrameSeries) => Record<string, unknown>) | undefined;
}

/** Every per-frame series of a run, in milliseconds. */
export interface FrameSeries {
  readonly wakes: number[];
  readonly dispatches: number[];
  readonly steps: number[];
  readonly encodes: number[];
  readonly frames: number[];
  readonly intervals: number[];
}

export interface FrameLoop {
  /** A wake from the render thread: records its latency, then steps every queued sample in order. */
  wake(sampleNs: number, handledNs: number): void;
  /** Ends the run with `error` shown in the window, or with the figures when it is undefined. */
  complete(error?: string): void;
  /** Stops any figure still pending from reading the window, which is about to close. */
  dispose(): void;
  readonly series: FrameSeries;
}

const thrown = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The step, scene and bookkeeping for each wake of a native window, on whichever thread runs the game. */
export function createFrameLoop(player: NativePlayer, window: WindowView, options: FrameLoopOptions, finished: (result: Readonly<Record<string, unknown>>) => void): FrameLoop {
  const series: FrameSeries = { wakes: [], dispatches: [], steps: [], encodes: [], frames: [], intervals: [] };
  const prepared = player.prepare();
  let ended = false, disposed = false, previous = 0, firstFrameAt = 0;

  const complete = (error?: string) => {
    if (ended) return;
    ended = true;
    if (error !== undefined) window.status(error);
    Effect.runFork(Effect.sleep(100).pipe(Effect.andThen(Effect.sync(() => {
      if (disposed) return;
      const elapsedMs = performance.now() - firstFrameAt;
      const result = error !== undefined ? { error } : {
        gpu: window.info().adapter, ...window.info(), isolated: false, startupMs: options.startupMs, prepared: { models: prepared.models.length, step: prepared.step },
        frames: series.frames.length, elapsedMs, fps: series.frames.length * 1000 / elapsedMs,
        frameMs: spread(series.frames), intervalMs: spread(series.intervals), presentedMs: spread(Array.from(window.metric("presentedMs"))),
        requestMs: spread(series.steps), renderMs: spread(Array.from(window.metric("drawMs"))), inputToPresentMs: spread(Array.from(window.metric("inputToPresentMs"))),
        wakeMs: spread(series.wakes), dispatchMs: spread(series.dispatches), encodeMs: spread(series.encodes), parseMs: spread(Array.from(window.metric("parseMs"))),
        audioEvents: 0, audioReadyEvents: 0, audioPlayed: 0, audioDecodedAssets: 0, missingSounds: [] as string[],
        ...options.extraResult?.(series),
      };
      finished(result);
    }))));
  };

  const step = (sample: InputSample) => {
    const began = performance.now();
    if (firstFrameAt === 0) firstFrameAt = began;
    series.dispatches.push((window.nowNs() - sample.sampleNs) / 1e6);
    if (previous !== 0) series.intervals.push(began - previous);
    previous = began;
    try {
      const input: StandaloneInput = options.scripted ? { buttons: [], axisX: 0, axisY: 0 } : { buttons: window.buttons(sample.mask), axisX: sample.axisX, axisY: sample.axisY };
      const frame = player.advance(input);
      const stepped = performance.now();
      window.submit(JSON.stringify(frame.scene), frame.step, sample.frame);
      const submitted = performance.now();
      series.steps.push(stepped - began);
      series.encodes.push(submitted - stepped);
      series.frames.push(submitted - began);
      options.afterFrame?.(series.frames.length);
      if (frame.done) complete();
    } catch (cause) {
      complete(thrown(cause));
    }
  };

  return {
    series,
    complete,
    dispose: () => { disposed = true; ended = true; },
    wake(sampleNs, handledNs) {
      series.wakes.push((handledNs - sampleNs) / 1e6);
      for (let sample = window.nextSample(); sample !== undefined && !ended; sample = window.nextSample()) step(sample);
    },
  };
}
