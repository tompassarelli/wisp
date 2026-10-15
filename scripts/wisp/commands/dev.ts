import { resolve } from "node:path";
import { Console, Effect, Layer } from "effect";
import { type Command, type CommandFailure, UsageFailure, flagValues } from "../command";
import { formatDesync, watchDesyncs } from "../desyncs";
import { FrameCosts, formatFrameCost } from "../frameCosts";
import { loop, type HotSide } from "../dev/loop";
import { elapsedLabel, plural } from "../dev/summary";
import type { DevProject } from "../dev/project";
import { GameFiles } from "../gameFiles";
import { modelFailureBridge } from "../modelFailures";
import { HotReload } from "../hotReload";
import { MapBuild } from "../mapBuild";
import { SourceErrors } from "../sourceErrors";
import { step } from "../timings";
import { validateDataDirectories } from "./hot";

export type { DevProject };

const seconds = (since: number) => elapsedLabel(Date.now() - since);

export const makeDev = (project: DevProject): Command => (args) => Effect.gen(function*() {
  const data = flagValues(args, "data");
  const [since] = flagValues(args, "since");
  if (since !== undefined) {
    if (data.length > 0) return yield* new UsageFailure({ problem: "dev --since takes no --data" });
    return yield* loop(project, undefined, Date.now, since);
  }
  if (data.length === 0) return yield* loop(project, undefined, Date.now);
  const hotProject = project.hot;
  if (hotProject === undefined) return yield* new UsageFailure({ problem: "this project declares no map to hot-reload" });
  const directories = yield* validateDataDirectories(data);
  const services = HotReload.layer(directories, hotProject.filePrefix).pipe(
    Layer.provideMerge(MapBuild.layer(hotProject.project)),
    Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: hotProject.sourceMapDirectory, filePrefix: hotProject.filePrefix ?? "wisp" })),
    Layer.provideMerge(FrameCosts.layer(hotProject.filePrefix)),
    Layer.provideMerge(GameFiles.layer()),
  );
  yield* Effect.gen(function*() {
    const reload = yield* HotReload;
    const sourceErrors = yield* SourceErrors;
    const desyncs = yield* watchDesyncs(directories);
    const frameCosts = yield* FrameCosts;
    const loadFailures = modelFailureBridge(yield* GameFiles, hotProject.filePrefix);

    yield* sourceErrors.changed(directories);
    yield* frameCosts.changed(directories);
    const report = (effect: Effect.Effect<unknown, CommandFailure>) => effect.pipe(Effect.asVoid, Effect.catch((failure) => Console.log(failure.message)));
    let running = false;
    let next: number | undefined;
    const publishFrom = (savedAt: number): Effect.Effect<void> => Effect.gen(function*() {
      const version = yield* reload.publish.pipe(step("hot", { root: true }), Effect.map((published) => ({ published })), Effect.catch((failure) => Effect.succeed({ failure })));
      if ("published" in version) yield* Console.log(`${seconds(savedAt)}hot: v${version.published} running in ${plural(directories.length, "client")}`);
      else yield* Console.log(`${seconds(savedAt)}hot: not applied: ${version.failure.message}`);
      const again = next;
      next = undefined;
      if (again !== undefined) yield* publishFrom(again);
    });
    const hot: HotSide = {
      sourceDirectory: resolve(hotProject.sourceDirectory),
      request: (savedAt) => Effect.suspend(() => {
        if (running) {
          next = savedAt;
          return Effect.void;
        }
        running = true;
        return publishFrom(savedAt).pipe(Effect.ensuring(Effect.sync(() => {
          running = false;
        })));
      }),
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
    yield* loop(project, hot, Date.now);
  }).pipe(Effect.provide(services));
});
