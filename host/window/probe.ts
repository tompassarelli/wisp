import { Effect } from "effect";
import { type StandaloneGame, openStandalone } from "../play/standalone";
import { type NativeWindow, openNativeWindow } from "./binding";
import { spread, summed } from "./stats";

/** Every per-frame series a probe run measured, in milliseconds, before the report turns them into percentiles. */
export interface ProbeSamples {
  readonly frames: number;
  readonly warmupFrames: number;
  readonly adapter: string;
  readonly backend: string;
  readonly presentMode: string;
  readonly desiredMaximumFrameLatency: number;
  readonly wakeMs: readonly number[];
  readonly stepMs: readonly number[];
  readonly encodeMs: readonly number[];
  readonly parseMs: readonly number[];
  readonly readAssetMs: readonly number[];
  readonly presentedMs: readonly number[];
  readonly drawMs: readonly number[];
  readonly sampleToPresentMs: readonly number[];
  readonly missedScenes: number;
}

const READ_ASSET_EVERY = 30;

/** Runs the game through the production player and window for `warmupFrames + frames` frames and keeps the last `frames` of each series. */
export const measureWindow = (game: StandaloneGame, frames: number, warmupFrames: number) => Effect.scoped(Effect.gen(function*() {
  const total = warmupFrames + frames;
  const wakes: number[] = [], steps: number[] = [], encodes: number[] = [], reads: number[] = [];
  let simulating = 0;
  const timed: StandaloneGame = {
    ...game,
    create: async (options) => {
      const session = await game.create(options);
      return { ...session, step: (input) => { const began = performance.now(); session.step(input); simulating = performance.now() - began; } };
    },
  };
  const player = yield* openStandalone(timed, { window: "native" });
  const finished = Promise.withResolvers<void>();
  const assets = [...(game.render.preloadModels ?? []), "missing\\probe.mdx"];
  const window = yield* Effect.acquireRelease(Effect.sync(() => {
    let busy = false;
    const opened: NativeWindow = openNativeWindow({
      title: `${game.title} · window probe`, width: game.render.width ?? 1280, height: game.render.height ?? 720,
      onWake: (wake) => {
        if (wake.kind !== "frame") return finished.reject(new Error(opened.error() ?? `the window ${wake.kind === "closed" ? "was closed" : "failed"} during the probe`));
        if (busy || steps.length >= total) return;
        busy = true;
        try {
          const began = performance.now();
          const frame = player.native.advance({ buttons: wake.buttons, axisX: 0, axisY: 0 });
          const stepped = performance.now();
          opened.submit(JSON.stringify(frame.scene), frame.step);
          const encoded = performance.now();
          wakes.push((wake.handledNs - wake.sampleNs) / 1e6);
          steps.push(simulating);
          encodes.push(stepped - began - simulating + encoded - stepped);
          if (steps.length % READ_ASSET_EVERY === 0) {
            const path = assets[(steps.length / READ_ASSET_EVERY) % assets.length] ?? "";
            const read = performance.now();
            void game.render.readAsset(path).then(() => reads.push(performance.now() - read));
          }
          if (steps.length === total) setTimeout(finished.resolve, 100);
        } finally { busy = false; }
      },
    });
    return opened;
  }), (open) => Effect.sync(() => open.close()));
  window.start();
  yield* Effect.promise(() => finished.promise);
  const keep = (series: readonly number[] | Float64Array) => Array.from(series).slice(-frames);
  return {
    frames, warmupFrames, ...window.info(), missedScenes: window.missedScenes(),
    wakeMs: keep(wakes), stepMs: keep(steps), encodeMs: keep(encodes), parseMs: keep(window.metric("parseMs")), readAssetMs: reads,
    presentedMs: keep(window.metric("presentedMs")), drawMs: keep(window.metric("drawMs")), sampleToPresentMs: keep(window.metric("sampleToPresentMs")),
  } satisfies ProbeSamples;
}));

/** The numbers the plan's first box asks for, from one run's samples and the collections' pauses. */
export function probeReport(samples: ProbeSamples, gcPauses: readonly number[]) {
  const { wakeMs, stepMs, encodeMs, parseMs, readAssetMs, presentedMs, drawMs, sampleToPresentMs, ...rest } = samples;
  return {
    ...rest,
    wakeMs: spread(wakeMs), stepMs: spread(stepMs),
    sceneMs: spread(summed(encodeMs, parseMs)), encodeMs: spread(encodeMs), parseMs: spread(parseMs),
    gcPauseMs: { ...spread(gcPauses), count: gcPauses.length },
    readAssetMs: spread(readAssetMs), presentedMs: spread(presentedMs), drawMs: spread(drawMs), sampleToPresentMs: spread(sampleToPresentMs),
  };
}
