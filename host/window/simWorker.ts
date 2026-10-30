// The thread that steps a native window's game: started by simPlayer.ts, which keeps Bun's main thread for the window's wake alone.
import { Effect } from "effect";
import { type StandaloneGame, openStandalone } from "../play/standalone";
import { attachNativeWindow, WAKE_ERROR, WAKE_FRAME } from "./binding";
import { createFrameLoop } from "./frameLoop";
import { type RenderSeries, type RenderSeriesName, renderSeriesLengths, renderSeriesSince } from "./renderSeries";
import { type WakeBox, takeWakes, wakeBox } from "./sharedWake";
import type { SimWorkerAttach, SimWorkerInit, SimWorkerMessage } from "./simProtocol";
import { GC_LOG_BEGIN, GC_LOG_END } from "./stats";

declare const self: Worker;

const attached = Promise.withResolvers<number>();
const READ_ASSET_EVERY = 30;

const send = (message: SimWorkerMessage) => self.postMessage(message);
const problemOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const run = async (init: SimWorkerInit) => {
  const began = performance.now();
  const module = await import(init.game.module) as Record<string, StandaloneGame | undefined>;
  const game = module[init.game.export];
  if (game === undefined) throw new Error(`${init.game.module} exports no ${init.game.export}`);
  const box: WakeBox = wakeBox(init.box);
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const player = yield* openStandalone(game, { ...init.options, window: "native" });
    send({ type: "ready" });
    const view = yield* Effect.acquireRelease(
      Effect.promise(() => attached.promise).pipe(Effect.map((handle) => attachNativeWindow(handle, init.library))),
      (opened) => Effect.sync(() => opened.release()),
    );
    const reads: number[] = [];
    let measuredFrom: Readonly<Record<RenderSeriesName, number>> | undefined;
    let measured: RenderSeries | undefined;
    const assets = [...(game.render.preloadModels ?? []), "missing\\probe.mdx"];
    const probe = init.probe;
    const loop = createFrameLoop(player.native, view, {
      scripted: init.options.script !== undefined,
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
      void player.native.finish(result).catch(() => undefined).then(() => send({ type: "completed", result }));
    });
    view.start();
    yield* Effect.promise(() => takeWakes(box, (wake) => {
      if (wake.kind === WAKE_FRAME) loop.wake(wake.sampleNs, wake.handledNs);
      else if (wake.kind === WAKE_ERROR) loop.complete(view.error() ?? "the window failed");
    }, loop.dispose));
  })));
};

self.onmessage = (event: MessageEvent<SimWorkerInit | SimWorkerAttach>) => {
  const message = event.data;
  if (message.type === "attach") attached.resolve(message.handle);
  else run(message).catch((cause) => send({ type: "failed", problem: problemOf(cause) }));
};
