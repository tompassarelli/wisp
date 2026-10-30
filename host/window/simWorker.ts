// The thread that steps a native window's game: started by simPlayer.ts. It blocks in the window's next_event, so it owns the frame loop and Bun's main thread keeps no part of it.
import { Effect } from "effect";
import { type StandaloneGame, openStandalone } from "../play/standalone";
import { type WindowView, adoptNativeWindow } from "./binding";
import { createModelLibrary, drawScene, preloadScene } from "./drawScene";
import { type FrameLoop, createFrameLoop } from "./frameLoop";
import { type RenderSeries, type RenderSeriesName, renderSeriesLengths, renderSeriesSince } from "./renderSeries";
import type { SimWorkerAttach, SimWorkerInit, SimWorkerMessage } from "./simProtocol";
import { GC_LOG_BEGIN, GC_LOG_END } from "./stats";

declare const self: Worker;

const attached = Promise.withResolvers<number>();
const READ_ASSET_EVERY = 30;
const EVENT_WAIT_MS = 1000;

const send = (message: SimWorkerMessage) => self.postMessage(message);
const problemOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Steps the game once per sample, in the order the render thread took them: block in the window, step, submit, then one macrotask turn so timers, messages and `readAsset` completions run outside the time from sample to scene. Returns when the window closes, fails or is stopped. */
const serve = (view: WindowView, loop: FrameLoop, finished: Promise<void>) => Effect.gen(function*() {
  for (;;) {
    const event = view.nextEvent(EVENT_WAIT_MS);
    if (event.kind === "frame") {
      loop.step(event.sample);
      yield* Effect.callback<void>((resume) => { setImmediate(() => resume(Effect.void)); });
    } else if (event.kind === "closed") {
      send({ type: "closed" });
      return;
    } else if (event.kind === "failed") {
      loop.complete(view.error() ?? "the window failed");
      yield* Effect.promise(() => finished);
      return;
    } else if (event.kind === "stopped") {
      loop.dispose();
      return;
    }
  }
});

const run = async (init: SimWorkerInit) => {
  const began = performance.now();
  const module = await import(init.game.module) as Record<string, StandaloneGame | undefined>;
  const game = module[init.game.export];
  if (game === undefined) throw new Error(`${init.game.module} exports no ${init.game.export}`);
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const player = yield* openStandalone(game, { ...init.options, window: "native" });
    send({ type: "ready" });
    const view = yield* Effect.acquireRelease(
      Effect.promise(() => attached.promise).pipe(Effect.map((handle) => adoptNativeWindow(handle, init.library))),
      (opened) => Effect.sync(() => opened.release()),
    );
    const finished = Promise.withResolvers<void>();
    const reads: number[] = [];
    let measuredFrom: Readonly<Record<RenderSeriesName, number>> | undefined;
    let measured: RenderSeries | undefined;
    const assets = [...(game.render.preloadModels ?? []), "missing\\probe.mdx"];
    const probe = init.probe;
    const library = createModelLibrary((path) => game.render.readAsset(path), view, (problem) => console.error(`native window: ${problem}`));
    const loop = createFrameLoop(player.native, view, {
      scripted: init.options.script !== undefined,
      encodeScene: (scene) => JSON.stringify(drawScene(scene, library)),
      startupMs: performance.now() - began,
      afterFrame: probe === undefined ? undefined : (count) => {
        if (count === probe.warmupFrames) {
          console.error(GC_LOG_BEGIN);
          measuredFrom = renderSeriesLengths(view);
        }
        if (count === probe.warmupFrames + probe.frames) {
          console.error(GC_LOG_END);
          if (measuredFrom !== undefined) measured = renderSeriesSince(view, measuredFrom, probe.frames);
        }
        if (count % READ_ASSET_EVERY === 0) {
          const read = performance.now();
          void game.render.readAsset(assets[(count / READ_ASSET_EVERY) % assets.length] ?? "").then(() => reads.push(performance.now() - read));
        }
      },
      extraResult: probe === undefined ? undefined : (series) => ({ series: { ...series, readAssets: reads, render: measured } }),
    }, (result) => {
      void player.native.finish(result).catch(() => undefined).then(() => { send({ type: "completed", result }); finished.resolve(); });
    });
    yield* Effect.promise(() => preloadScene(player.native.prepare().scene, library, () => view.assetsPending()));
    view.start();
    yield* serve(view, loop, finished.promise);
  })));
};

self.onmessage = (event: MessageEvent<SimWorkerInit | SimWorkerAttach>) => {
  const message = event.data;
  if (message.type === "attach") attached.resolve(message.handle);
  else run(message).catch((cause) => send({ type: "failed", problem: problemOf(cause) }));
};
