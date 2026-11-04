import { Effect } from "effect";
import { edenGC } from "bun:jsc";
import type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";
import type { InputSample, WindowView } from "./binding";
import { RENDER_SERIES, gpuReport } from "./renderSeries";
import { spread, spreads } from "./stats";

/** What `openStandalone` gives a window that drives the session itself: the scene before the first step, one step, and the end of the run, whose result comes back with the sound figures added. */
export interface NativePlayer {
  prepare(): { readonly scene: StandaloneFrame["scene"]; readonly models: readonly string[]; readonly step: number };
  advance(input: StandaloneInput): StandaloneFrame;
  finish(result: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
}

export interface FrameLoopOptions {
  readonly scripted: boolean;
  /** Milliseconds from starting the player to its first frame, reported as `startupMs`. */
  readonly startupMs: number;
  /** Called with each sample before it is stepped. */
  readonly onSample?: ((sample: InputSample) => void) | undefined;
  /** Called once per finished frame with the count so far. */
  readonly afterFrame?: ((count: number) => void) | undefined;
  /** Fields added to the result, such as the raw series a probe reads. */
  readonly extraResult?: ((series: FrameSeries) => Record<string, unknown>) | undefined;
  /** Turns a step's scene into the text the window draws; JSON of the whole scene when absent. */
  readonly encodeScene?: ((scene: StandaloneFrame["scene"]) => string) | undefined;
  readonly warmupFrames?: number | undefined;
}

/** Every per-frame series of a run, in milliseconds. */
export interface FrameSeries {
  readonly wakes: number[];
  readonly steps: number[];
  readonly encodes: number[];
  readonly frames: number[];
  readonly intervals: number[];
  /** The stage times the game returned with its steps (`StandaloneFrame.stages`), one series per name. */
  readonly stages: Record<string, number[]>;
}

export interface FrameLoop {
  /** Steps one sample taken from `nextEvent`, recording the time from when the render thread took it to when this thread got it; does nothing once the run has ended. */
  step(sample: InputSample): void;
  /** Ends the run with `error` shown in the window, or with the figures when it is undefined. */
  complete(error?: string): void;
  /** Stops any figure still pending from reading the window, which is about to close. */
  dispose(): void;
  readonly series: FrameSeries;
}

const thrown = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The step, scene and bookkeeping for each sample of a native window, on whichever thread runs the game. */
export function createFrameLoop(player: NativePlayer, window: WindowView, options: FrameLoopOptions, finished: (result: Readonly<Record<string, unknown>>) => void): FrameLoop {
  const series: FrameSeries = { wakes: [], steps: [], encodes: [], frames: [], intervals: [], stages: {} };
  const prepared = player.prepare();
  let ended = false, disposed = false, previous = 0, measuredAt = 0;
  const warmup = options.warmupFrames ?? 0;
  const lengths = (): Readonly<Record<string, number>> => Object.fromEntries([...RENDER_SERIES, "renderScalePercent"].map((name) => [name, window.metric(name).length]));
  let renderFrom: Readonly<Record<string, number>> = {}, stagesFrom: Readonly<Record<string, number>> = {};
  const rendered = (name: string) => Array.from(window.metric(name)).slice(renderFrom[name] ?? 0);
  const measured = (values: readonly number[]) => values.slice(warmup);

  const complete = (error?: string) => {
    if (ended) return;
    ended = true;
    if (error !== undefined) window.status(error);
    Effect.runFork(Effect.sleep(100).pipe(Effect.andThen(Effect.sync(() => {
      if (disposed) return;
      const elapsedMs = performance.now() - measuredAt;
      const result = error !== undefined ? { error } : {
        gpu: window.info().adapter, ...window.info(), isolated: false, startupMs: options.startupMs, prepared: { models: prepared.models.length, step: prepared.step },
        frames: series.frames.length, elapsedMs, fps: measured(series.frames).length * 1000 / elapsedMs, ...(warmup === 0 ? {} : { warmupFrames: warmup }),
        frameMs: spread(measured(series.frames)), intervalMs: spread(series.intervals.slice(Math.max(0, warmup - 1))), presentedMs: spread(rendered("presentedMs")),
        requestMs: spread(measured(series.steps)), renderMs: spread(rendered("drawMs")), cpuEncodeMs: spread(rendered("cpuEncodeMs")), renderScalePercent: spread(rendered("renderScalePercent")),
        ...gpuReport(rendered, window.info().gpuTimingUnavailable), stageMs: spreads(Object.fromEntries(Object.entries(series.stages).map(([name, values]) => [name, values.slice(stagesFrom[name] ?? 0)]))), inputToPresentMs: spread(rendered("inputToPresentMs")),
        wakeMs: spread(measured(series.wakes)), encodeMs: spread(measured(series.encodes)), parseMs: spread(rendered("parseMs")),
        audioEvents: 0, audioReadyEvents: 0, audioPlayed: 0, audioDecodedAssets: 0, missingSounds: [] as string[],
        ...options.extraResult?.(series),
      };
      finished(result);
    }))));
  };

  const step = (sample: InputSample) => {
    if (ended) return;
    const began = performance.now();
    if (series.frames.length === warmup) {
      measuredAt = began;
      if (warmup > 0) { renderFrom = lengths(); stagesFrom = Object.fromEntries(Object.entries(series.stages).map(([name, values]) => [name, values.length])); }
    }
    options.onSample?.(sample);
    series.wakes.push((window.nowNs() - sample.sampleNs) / 1e6);
    if (previous !== 0) series.intervals.push(began - previous);
    previous = began;
    try {
      const screen = { width: sample.pointer.width, height: sample.pointer.height };
      const input: StandaloneInput = options.scripted ? { buttons: [], axisX: 0, axisY: 0, screen } : { buttons: window.buttons(sample.mask), axisX: sample.axisX, axisY: sample.axisY, pointer: sample.pointer, keys: sample.keys, screen };
      const frame = player.advance(input);
      for (const [name, ms] of Object.entries(frame.stages ?? {})) (series.stages[name] ??= []).push(ms);
      const stepped = performance.now();
      window.submit(options.encodeScene === undefined ? JSON.stringify(frame.scene) : options.encodeScene(frame.scene), frame.step, sample.frame);
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
    step,
  };
}

const EVENT_WAIT_MS = 1000;
const NET_POLL_MS = 1;
/** Frames between event-loop turns once nothing is being read: Bun 1.4.4 collects rarely on its own but then inside a step, so turns and collections are taken here, between frames (docs/native-window-plan.md, "The game steps on a worker thread"). */
export const YIELD_EVERY_FRAMES = 12;

const turn = Effect.callback<void>((resume) => { setImmediate(() => resume(Effect.void)); });

/**
 * Steps the game once per sample, in the order the render thread took them: wait in the window, step, submit, then, every
 * `YIELD_EVERY_FRAMES` frames or on any frame while `reading` says a read is in flight, one macrotask turn so timers, messages and
 * `readAsset` completions run, followed by an eden collection that also finishes any collection Bun asked for in that turn, so each
 * collection runs between a submit and the next sample instead of inside a step. A networked match's peer owns sockets and timers on this
 * thread, so there every frame takes a turn and the wait never blocks: with no sample queued the thread sleeps 1 ms on its event loop
 * instead, and the eden collection still follows every `YIELD_EVERY_FRAMES`th frame's turn, since Bun's own collections would otherwise land
 * inside a transport step or a scene (wisp#229). Returns whether the window closed, or failed or was stopped.
 */
export const serveFrames = (view: WindowView, loop: FrameLoop, finished: Promise<void>, networked: boolean, reading: () => boolean = () => false, collect: () => void = edenGC) => Effect.gen(function*() {
  let sinceTurn = 0;
  for (;;) {
    const event = view.nextEvent(networked ? 0 : EVENT_WAIT_MS);
    if (event.kind === "timeout") {
      if (networked) yield* Effect.sleep(NET_POLL_MS);
    } else if (event.kind === "frame") {
      loop.step(event.sample);
      const due = ++sinceTurn >= YIELD_EVERY_FRAMES || (!networked && reading());
      if (due) sinceTurn = 0;
      if (networked || due) yield* turn;
      if (due) collect();
    } else if (event.kind === "closed") {
      return "closed";
    } else if (event.kind === "failed") {
      loop.complete(view.error() ?? "the window failed");
      yield* Effect.promise(() => finished);
      return "ended";
    } else {
      loop.dispose();
      return "ended";
    }
  }
});
