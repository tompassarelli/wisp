// The thread that steps a native window's game: started by simPlayer.ts. It blocks in the window's next_event, so it owns the frame loop and Bun's main thread keeps no part of it.
import { Effect } from "effect";
import { openStandalone } from "../play/standalone";
import { openNetMatch } from "../play/standaloneNet";
import type { NetReport } from "../net/peer";
import { adoptNativeWindow } from "./binding";
import { createModelLibrary, drawScene, preloadAll, preloadAssets, preloadScene } from "./drawScene";
import { createFrameLoop, serveFrames } from "./frameLoop";
import { loadGame } from "./gameModule";
import { type RenderSeries, type RenderSeriesName, renderSeriesLengths, renderSeriesSince } from "./renderSeries";
import type { SimWorkerAttach, SimWorkerInit, SimWorkerMessage } from "./simProtocol";
import { SAMPLE_LOG_VARIABLE, openSampleLog } from "./sampleLog";
import { GC_LOG_BEGIN, GC_LOG_END } from "./stats";

declare const self: Worker;

const attached = Promise.withResolvers<number>();
const READ_ASSET_EVERY = 30;

/** How a networked match's peer ended, added to the run's figures: its report, the other player leaving or going quiet, or an error. */
interface NetEnd { readonly net?: NetReport; readonly netEnded?: string; readonly error?: string }

const send = (message: SimWorkerMessage) => self.postMessage(message);
const problemOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const run = async (init: SimWorkerInit) => {
  const began = performance.now();
  const game = await loadGame(init.game);
  const ending = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    send({ type: "ready" });
    const view = yield* Effect.acquireRelease(
      Effect.promise(() => attached.promise).pipe(Effect.map((handle) => adoptNativeWindow(handle, init.library))),
      (opened) => Effect.sync(() => opened.release()),
    );
    const library = createModelLibrary((path) => game.render.readAsset(path), view, (problem) => console.error(`native window: ${problem}`));
    const { net } = init.options;
    const match = net === undefined ? undefined : yield* preloadAll(game.render, library).pipe(Effect.andThen(openNetMatch(game, init.options, net)));
    const player = yield* openStandalone(match?.game ?? game, { ...init.options, window: "native", library: init.library });
    const finished = Promise.withResolvers<void>();
    const reads: number[] = [];
    let measuredFrom: Readonly<Record<RenderSeriesName, number>> | undefined;
    let measured: RenderSeries | undefined;
    const assets = [...(game.render.preloadModels ?? []), "missing\\probe.mdx"];
    const probe = init.probe;
    const sampleLogPath = process.env[SAMPLE_LOG_VARIABLE];
    const loop = createFrameLoop(player.native, view, {
      scripted: init.options.script !== undefined,
      onSample: sampleLogPath === undefined ? undefined : openSampleLog(sampleLogPath, view),
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
      void player.native.finish(result).catch(() => result).then(async (final) => { send({ type: "completed", result: { ...final, ...await netEnd.promise } }); finished.resolve(); });
    });
    const netEnd = Promise.withResolvers<NetEnd>();
    if (match === undefined) netEnd.resolve({});
    else yield* Effect.forkScoped(match.ended.pipe(
      Effect.map((report): NetEnd => ({ net: report })),
      Effect.catchTags({
        PeerLeft: (left) => Effect.succeed<NetEnd>({ netEnded: `${left.message}; the session ended` }),
        PeerSilent: (silent) => Effect.succeed<NetEnd>({ netEnded: `${silent.message}; the session ended` }),
      }),
      Effect.catch((error) => Effect.succeed<NetEnd>({ error: error.message })),
      Effect.tap((end) => Effect.sync(() => {
        if (end.netEnded !== undefined) console.log(`${game.title}: ${end.netEnded}`);
        netEnd.resolve(end);
        loop.complete(end.error);
      })),
    ));
    yield* preloadScene(player.native.prepare().scene, library, () => view.assetsPending());
    view.start();
    preloadAssets(game.render, library);
    return yield* serveFrames(view, loop, finished.promise, match !== undefined);
  })));
  if (ending === "closed") send({ type: "closed" });
};

self.onmessage = (event: MessageEvent<SimWorkerInit | SimWorkerAttach>) => {
  const message = event.data;
  if (message.type === "attach") attached.resolve(message.handle);
  else run(message).catch((cause) => send({ type: "failed", problem: problemOf(cause) }));
};
