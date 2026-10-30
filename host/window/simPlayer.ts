import { Effect } from "effect";
import { RenderFailure } from "../render/headlessRender";
import { WAKE_CLOSED, openNativeWindow } from "./binding";
import { NATIVE_HELP, type NativePlayOptions } from "./nativePlay";
import { publishWake, stopWakes, wakeBox } from "./sharedWake";
import type { NativeGameModule, SimWorkerInit, SimWorkerMessage, WorkerPlayOptions } from "./simProtocol";

export interface SimPlayerOptions extends NativePlayOptions {
  readonly game: NativeGameModule;
  readonly standalone: WorkerPlayOptions;
  readonly library?: string | undefined;
  readonly probe?: SimWorkerInit["probe"];
}

const STOP_WAIT_MS = 2000;

/**
 * Opens the native window with a worker thread that steps the game, so Bun's main thread holds only the window's wake: it writes the
 * wake's numbers into shared memory and signals the worker, and the worker steps, encodes and hands the scene to the render thread itself.
 * The game's collections then run on the worker and never delay a wake; `completed` carries the run's figures.
 */
export const openSimPlayer = (options: SimPlayerOptions) => Effect.gen(function*() {
  const opened = performance.now();
  const box = wakeBox();
  const ready = Promise.withResolvers<void>(), completed = Promise.withResolvers<Readonly<Record<string, unknown>>>(), closing = Promise.withResolvers<void>();
  void ready.promise.catch(() => undefined);
  void completed.promise.catch(() => undefined);
  const worker = yield* Effect.acquireRelease(Effect.sync(() => new Worker(new URL("./simWorker.ts", import.meta.url).href)), (thread) => Effect.sync(() => thread.terminate()));
  worker.onmessage = (event: MessageEvent<SimWorkerMessage>) => {
    const message = event.data;
    if (message.type === "ready") ready.resolve();
    else if (message.type === "completed") completed.resolve(message.result);
    else { ready.reject(new Error(message.problem)); completed.reject(new Error(message.problem)); }
  };
  worker.onerror = (event) => { ready.reject(event.error ?? new Error(event.message)); completed.reject(event.error ?? new Error(event.message)); };
    const init: SimWorkerInit = { type: "init", game: options.game, options: options.standalone, box: box.buffer, library: options.library, probe: options.probe };
  worker.postMessage(init);
  yield* Effect.tryPromise({ try: () => ready.promise, catch: (cause) => new RenderFailure({ cause }) });

  const window = yield* Effect.acquireRelease(
    Effect.try({
      try: () => openNativeWindow({
        title: options.title, width: options.width, height: options.height, library: options.library,
        onWake: (kind, frame, sampleNs, mask, handledNs) => {
          publishWake(box, kind, frame, sampleNs, mask, handledNs);
          if (kind === WAKE_CLOSED) closing.resolve();
        },
      }),
      catch: (cause) => new RenderFailure({ cause }),
    }),
    (open) => Effect.sync(() => { stopWakes(box, STOP_WAIT_MS); open.close(); }),
  );
  window.status(`${options.title} · loading game…`);
  worker.postMessage({ type: "attach", handle: window.handle });
  window.selectPad(options.standalone.gamepadIndex);
  window.status(`${options.title} · ${options.scripted ? "scripted run" : NATIVE_HELP}`);
  return {
    startupMs: performance.now() - opened,
    completed: Effect.tryPromise({ try: () => completed.promise, catch: (cause) => new RenderFailure({ cause }) }).pipe(
      Effect.filterOrFail((result) => typeof result.error !== "string", (result) => new RenderFailure({ cause: new Error(String(result.error)) })),
    ),
    closed: Effect.promise(() => closing.promise),
  };
});
