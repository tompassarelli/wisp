import { Effect } from "effect";
import { RenderFailure } from "../render/headlessRender";
import { openNativeWindow } from "./binding";
import type { NativeGameModule, SimWorkerInit, SimWorkerMessage, WorkerPlayOptions } from "./simProtocol";

export interface SimPlayerOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly scripted: boolean;
  readonly game: NativeGameModule;
  readonly standalone: WorkerPlayOptions;
  readonly library?: string | undefined;
  readonly probe?: SimWorkerInit["probe"];
}

const NATIVE_HELP = "Arrows / WASD move · J attack · K special · Space jump · L grab · Shift shield · Enter pause";

/**
 * Opens the native window with a worker thread that owns the frame loop: the worker blocks in the window's `next_event`, steps the game,
 * encodes the scene and hands it to the render thread itself, so Bun's main thread has no part in a frame and the game's collections run
 * on the worker. The main thread waits for the worker's `completed`, `closed` or `failed`; `completed` carries the run's figures.
 */
export const openSimPlayer = (options: SimPlayerOptions) => Effect.gen(function*() {
  const opened = performance.now();
  const ready = Promise.withResolvers<void>(), completed = Promise.withResolvers<Readonly<Record<string, unknown>>>(), closing = Promise.withResolvers<void>();
  void ready.promise.catch(() => undefined);
  void completed.promise.catch(() => undefined);
  const worker = yield* Effect.acquireRelease(Effect.sync(() => new Worker(new URL("./simWorker.ts", import.meta.url).href)), (thread) => Effect.sync(() => thread.terminate()));
  worker.onmessage = (event: MessageEvent<SimWorkerMessage>) => {
    const message = event.data;
    if (message.type === "ready") ready.resolve();
    else if (message.type === "closed") closing.resolve();
    else if (message.type === "completed") completed.resolve(message.result);
    else { ready.reject(new Error(message.problem)); completed.reject(new Error(message.problem)); }
  };
  worker.onerror = (event) => { ready.reject(event.error ?? new Error(event.message)); completed.reject(event.error ?? new Error(event.message)); };
  const init: SimWorkerInit = { type: "init", game: options.game, options: options.standalone, library: options.library, probe: options.probe };
  worker.postMessage(init);
  yield* Effect.tryPromise({ try: () => ready.promise, catch: (cause) => new RenderFailure({ cause }) });

  const window = yield* Effect.acquireRelease(
    Effect.try({
      try: () => openNativeWindow({ title: options.title, width: options.width, height: options.height, library: options.library }),
      catch: (cause) => new RenderFailure({ cause }),
    }),
    (open) => Effect.sync(() => open.close()),
  );
  window.status(`${options.title} · loading game…`);
  worker.postMessage({ type: "attach", handle: window.lend() });
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
