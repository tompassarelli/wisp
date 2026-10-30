import { Effect } from "effect";
import type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";
import { RenderFailure } from "../render/headlessRender";
import { type NativeWindow, type Wake, openNativeWindow } from "./binding";
import { spread } from "./stats";

/** What `openStandalone` gives a window that drives the session itself: the scene before the first step, one step, and the end of the run. */
export interface NativePlayer {
  prepare(): { readonly models: readonly string[]; readonly step: number };
  advance(input: StandaloneInput): StandaloneFrame;
  finish(result: Readonly<Record<string, unknown>>): Effect.Effect<void, RenderFailure>;
}

export interface NativePlayOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly scripted: boolean;
}

const HELP = "Arrows / WASD move · J attack · K special · Space jump · L grab · Shift shield · Enter pause";

/** Ends the run from the window's callback, which has no Effect around it. */
const settle = (player: NativePlayer, result: Readonly<Record<string, unknown>>) => { void Effect.runPromise(player.finish(result)).catch(() => undefined); };

const thrown = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Opens the native window for `player` and returns its lifetime: `closed` ends when the player closes the window before the run completes. */
export const openNativePlayer = (player: NativePlayer, options: NativePlayOptions) => Effect.gen(function*() {
  const opened = performance.now();
  const closing = Promise.withResolvers<void>();
  const wakes: number[] = [], steps: number[] = [], encodes: number[] = [], frames: number[] = [], intervals: number[] = [];
  let busy = false, ended = false, previous = 0, window: NativeWindow | undefined;
  let startupMs = 0;
  const prepared = player.prepare();

  const complete = (error?: string) => {
    if (ended) return;
    ended = true;
    if (error !== undefined) window?.status(error);
    setTimeout(() => {
      const at = window;
      if (at === undefined) return;
      const finished = performance.now();
      const elapsedMs = finished - opened - startupMs;
      const presented = Array.from(at.metric("presentedMs")), parse = Array.from(at.metric("parseMs"));
      const result = error !== undefined ? { error } : {
        gpu: at.info().adapter, ...at.info(), isolated: false, startupMs, prepared: { models: prepared.models.length, step: prepared.step },
        frames: frames.length, elapsedMs, fps: frames.length * 1000 / elapsedMs,
        frameMs: spread(frames), intervalMs: spread(intervals), presentedMs: spread(presented),
        requestMs: spread(steps), renderMs: spread(Array.from(at.metric("drawMs"))), sampleToPresentMs: spread(Array.from(at.metric("sampleToPresentMs"))),
        wakeMs: spread(wakes), encodeMs: spread(encodes), parseMs: spread(parse), missedScenes: at.missedScenes(),
        audioEvents: 0, audioReadyEvents: 0, audioPlayed: 0, audioDecodedAssets: 0, missingSounds: [] as string[],
      };
      settle(player, result);
    }, 100);
  };

  const onFrame = (wake: Wake) => {
    if (busy || ended) return;
    busy = true;
    const began = performance.now();
    wakes.push((wake.handledNs - wake.sampleNs) / 1e6);
    if (previous !== 0) intervals.push(began - previous);
    previous = began;
    try {
      const frame = player.advance(options.scripted ? { buttons: [], axisX: 0, axisY: 0 } : { buttons: wake.buttons, axisX: 0, axisY: 0 });
      const stepped = performance.now();
      window?.submit(JSON.stringify(frame.scene), frame.step);
      const submitted = performance.now();
      steps.push(stepped - began);
      encodes.push(submitted - stepped);
      frames.push(submitted - began);
      if (frame.done) complete();
    } catch (cause) {
      complete(thrown(cause));
    } finally {
      busy = false;
    }
  };

  const onWake = (wake: Wake) => {
    if (wake.kind === "frame") onFrame(wake);
    else if (wake.kind === "error") complete(window?.error() ?? "the window failed");
    else closing.resolve();
  };

  yield* Effect.acquireRelease(
    Effect.try({ try: () => { window = openNativeWindow({ ...options, onWake }); return window; }, catch: (cause) => new RenderFailure({ cause }) }),
    (open) => Effect.sync(() => open.close()),
  );
  window?.status(`${options.title} · loading game…`);
  startupMs = performance.now() - opened;
  window?.status(`${options.title} · ${options.scripted ? "scripted run" : HELP}`);
  window?.start();
  return { closed: Effect.promise(() => closing.promise) };
});
