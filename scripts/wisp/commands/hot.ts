// `wisp hot`: publishes the map bundle to running clients and reports how
// long the change took to run in every client. With --watch it publishes every
// saved change and prints in-game errors with TypeScript lines and the
// engine values that diverged in a Warcraft desync.
import { type FSWatcher, watch } from "node:fs";
import { Console, Effect, Layer, Queue, Schema } from "effect";
import { type Command, type CommandFailure, UsageFailure, flagValues } from "../command";
import { Desyncs, formatDesync } from "../desyncs";
import { GameFiles } from "../gameFiles";
import { HotReload } from "../hotReload";
import { MapBuild, type BuildProject } from "../mapBuild";
import { SourceErrors } from "../sourceErrors";
import { step } from "../timings";

export interface HotProject {
  readonly project: BuildProject;
  readonly sourceDirectory: string;
  readonly sourceMapDirectory: string;
  readonly filePrefix?: string;
}

const DataDirectories = Schema.NonEmptyArray(Schema.String.check(Schema.isMinLength(1))).check(Schema.isUnique());

export const validateDataDirectories = (input: readonly string[]) =>
  Schema.decodeUnknownEffect(DataDirectories)(input).pipe(
    Effect.mapError((cause) => new UsageFailure({ problem: `--data needs one or more distinct client CustomMapData folders: ${cause.message}` })),
  );

export const makeHot = ({ project, sourceDirectory, sourceMapDirectory, filePrefix = "wisp" }: HotProject): Command => (args) => Effect.gen(function*() {
  const directories = yield* validateDataDirectories(flagValues(args, "data"));
  const services = HotReload.layer(directories, filePrefix).pipe(
    Layer.provideMerge(MapBuild.layer(project)),
    Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory, filePrefix })),
    Layer.merge(Desyncs.layer(directories)),
    Layer.provideMerge(GameFiles.layer()),
  );
  yield* Effect.gen(function*() {
    const reload = yield* HotReload;
    const sourceErrors = yield* SourceErrors;
    const desyncs = yield* Desyncs;
    // Reports from before Wisp started are old news.
    yield* sourceErrors.changed(directories);
    if (!args.includes("--watch")) {
      yield* reload.publish.pipe(step("reload", { root: true }));
      return;
    }
    const printErrors = Effect.gen(function*() {
      const desync = yield* desyncs.changed;
      if (desync !== undefined) yield* Console.error(formatDesync(desync));
      const reports = yield* sourceErrors.changed(directories);
      yield* Effect.forEach(reports, (report) =>
        Console.error(`p${report.slot} ${report.heading} (${report.latency.toFixed(0)} ms after the game wrote it)\n${report.text}`), { discard: true });
    });
    const request = coalesced(reload.publish);
    yield* report(request.pipe(step("reload", { root: true })));
    yield* Console.log(`watching ${sourceDirectory} for changes`);
    yield* runHotWatch(sourceDirectory, request, printErrors);
  }).pipe(Effect.provide(services));
});

const report = <A>(effect: Effect.Effect<A, CommandFailure>) => effect.pipe(Effect.asVoid, Effect.catch((failure) => Console.error(failure.message)));

/** One run at a time; requests during a run start one more afterwards. */
function coalesced<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<void, E> {
  let running = false;
  let again = false;
  return Effect.suspend(() => {
    if (running) {
      again = true;
      return Effect.void;
    }
    running = true;
    return Effect.gen(function*() {
      do {
        again = false;
        yield* effect;
      } while (again);
    }).pipe(Effect.ensuring(Effect.sync(() => {
      running = false;
    })));
  });
}

/** Ends when the process is asked to stop. */
export const waitForProcessStop: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const stop = () => resume(Effect.void);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return Effect.sync(() => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  });
});

/**
 * Runs `onChange` after each change under the supplied source directory and `onPoll` every 50 ms,
 * printing their failures, until `stop`. Everything it started ends with it. Each change is a
 * root `reload` step timed from its detection, so its end is the time since the save.
 */
export const runHotWatch = (
  sourceDirectory: string,
  onChange: Effect.Effect<void, CommandFailure>,
  onPoll: Effect.Effect<void, CommandFailure>,
  stop: Effect.Effect<void> = waitForProcessStop,
) =>
  Effect.scoped(
    Effect.gen(function*() {
      const sourceEvents = yield* Effect.acquireRelease(
        Queue.unbounded<void>(),
        (events) => Queue.shutdown(events),
      );
      const pollEvents = yield* Effect.acquireRelease(
        Queue.unbounded<void>(),
        (events) => Queue.shutdown(events),
      );
      let sourcePending = false;
      let pollPending = false;
      const watcher: FSWatcher = yield* Effect.acquireRelease(
        Effect.try({
          try: () => watch(sourceDirectory, { recursive: true }, () => {
            if (sourcePending) return;
            sourcePending = true;
            Queue.offerUnsafe(sourceEvents, undefined);
          }),
          catch: (cause) => new UsageFailure({ problem: `can't watch ${sourceDirectory}: ${String(cause)}` }),
        }),
        (resource) => Effect.sync(() => resource.close()),
      );
      void watcher;

      yield* Effect.acquireRelease(
        Effect.sync(() => setInterval(() => {
          if (pollPending) return;
          pollPending = true;
          Queue.offerUnsafe(pollEvents, undefined);
        }, 50)),
        (timer) => Effect.sync(() => clearInterval(timer)),
      );

      const sourceWorker = Effect.forever(Effect.gen(function*() {
        yield* Queue.take(sourceEvents);
        yield* Effect.gen(function*() {
          // An editor's save can be several events; they make one change.
          yield* Effect.sleep("10 millis");
          sourcePending = false;
          yield* report(onChange);
        }).pipe(step("reload", { root: true }));
      }));
      const pollWorker = Effect.forever(Effect.gen(function*() {
        yield* Queue.take(pollEvents);
        pollPending = false;
        yield* report(onPoll);
      }));
      yield* Effect.forkScoped(sourceWorker);
      yield* Effect.forkScoped(pollWorker);
      yield* stop;
    }),
  );
