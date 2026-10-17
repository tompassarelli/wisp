import { resolve } from "node:path";
import { Console, Effect, Layer } from "effect";
import type { CommandFailure } from "../command";
import { formatDesync, watchDesyncs } from "../desyncs";
import { FrameCosts, formatFrameCost } from "../frameCosts";
import { GameFiles } from "../gameFiles";
import { HotReload, type HotProject } from "../hotReload";
import { MapBuild } from "../mapBuild";
import { modelFailureBridge } from "../modelFailures";
import { SourceErrors } from "../sourceErrors";
import { step } from "../timings";
import type { HotSide } from "./context";
import { elapsedLabel, plural } from "./summary";

const seconds = (since: number) => elapsedLabel(Date.now() - since);

export const hotServices = (hotProject: HotProject, directories: readonly [string, ...string[]]) => HotReload.layer(directories, hotProject.filePrefix).pipe(
  Layer.provideMerge(MapBuild.layer(hotProject.project)),
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: hotProject.sourceMapDirectory, filePrefix: hotProject.filePrefix ?? "wisp" })),
  Layer.provideMerge(FrameCosts.layer(hotProject.filePrefix)),
  Layer.provideMerge(GameFiles.layer()),
);

const latestOnly = (publish: (savedAt: number) => Effect.Effect<void>) => {
  let running = false;
  let next: number | undefined;
  const publishFrom = (savedAt: number): Effect.Effect<void> => Effect.gen(function*() {
    yield* publish(savedAt);
    const again = next;
    next = undefined;
    if (again !== undefined) yield* publishFrom(again);
  });
  return (savedAt: number) => Effect.suspend(() => {
    if (running) {
      next = savedAt;
      return Effect.void;
    }
    running = true;
    return publishFrom(savedAt).pipe(Effect.ensuring(Effect.sync(() => {
      running = false;
    })));
  });
};

const report = (effect: Effect.Effect<unknown, CommandFailure>) => effect.pipe(Effect.asVoid, Effect.catch((failure) => Console.log(failure.message)));

export const hotSide = (hotProject: HotProject, directories: readonly [string, ...string[]]) => Effect.gen(function*() {
  const reload = yield* HotReload;
  const sourceErrors = yield* SourceErrors;
  const desyncs = yield* watchDesyncs(directories);
  const frameCosts = yield* FrameCosts;
  const loadFailures = modelFailureBridge(yield* GameFiles, hotProject.filePrefix);

  yield* sourceErrors.changed(directories);
  yield* frameCosts.changed(directories);
  const publish = (savedAt: number) => Effect.gen(function*() {
    const version = yield* reload.publish.pipe(step("hot", { root: true }), Effect.map((published) => ({ published })), Effect.catch((failure) => Effect.succeed({ failure })));
    if ("published" in version) yield* Console.log(`${seconds(savedAt)}hot: v${version.published} running in ${plural(directories.length, "client")}`);
    else yield* Console.log(`${seconds(savedAt)}hot: not applied: ${version.failure.message}`);
  });
  const side: HotSide = {
    sourceDirectory: resolve(hotProject.sourceDirectory),
    request: latestOnly(publish),
    poll: report(Effect.gen(function*() {
      yield* loadFailures(directories);
      const desync = yield* desyncs.changed;
      if (desync !== undefined) yield* Console.log(formatDesync(desync));
      const reports = yield* sourceErrors.changed(directories);
      yield* Effect.forEach(reports, (found) =>
        Console.log(`p${found.slot} ${found.heading} (${found.latency.toFixed(0)} ms after the game wrote it)\n${found.text}`), { discard: true });
      const costs = yield* frameCosts.changed(directories);
      yield* Effect.forEach(costs, ({ slot, report: cost }) => Console.log(formatFrameCost(slot, cost, hotProject.frameCostThreshold)), { discard: true });
    })),
  };
  return side;
});
