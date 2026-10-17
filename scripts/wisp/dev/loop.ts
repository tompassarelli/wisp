import { type FSWatcher, statSync, watch } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Console, Deferred, Effect, Fiber, Queue, Result } from "effect";
import { UsageFailure } from "../cli/command";
import { runProcess } from "./devProcesses";
import { waitForProcessStop } from "./hotReload";
import type { Changes } from "./testSelection";
import { formatTypeError } from "./typeCheck";
import { type Clock, type Context, type HotSide, open, typeChecking } from "./context";
import type { DevProject } from "./project";
import { selectRun } from "./select";
import { indent, plural } from "./summary";
import { allJourneys, unitTests } from "./tests";

const types = (ctx: Context, changed: readonly string[], savedAt: number) => Effect.gen(function*() {
  const { checker, local, seconds, root } = ctx;
  const checked = yield* typeChecking("check the saved files", () => checker.check(changed)).pipe(Effect.result);
  if (Result.isFailure(checked)) return yield* Effect.andThen(ctx.problem, Console.log(`${seconds(savedAt)}types: ${checked.failure.message}`));
  const result = checked.success;
  if (result.files.length === 0) return;
  const names = result.files.map(local).join(", ");
  if (result.errors.length === 0) return yield* Console.log(`${seconds(savedAt)}types: no errors in ${names}`);
  yield* ctx.problem;
  yield* Console.log(`${seconds(savedAt)}types: ${plural(result.errors.length, "error")} in ${names}\n${result.errors.map((error) => indent(formatTypeError(root, error))).join("\n")}`);
});

const run = (ctx: Context, changes: Changes | undefined, savedAt: number) => Effect.gen(function*() {
  const { hot, turns } = ctx;
  const picked = selectRun(changes, ctx.plan, ctx.root);
  if (picked.reopen) yield* typeChecking("reopen the projects", () => ctx.checker.reopen()).pipe(Effect.catch((failure) => Console.log(failure.message)));
  for (const line of picked.announce) yield* Console.log(line);
  if (hot !== undefined && (changes === undefined || picked.saved.some((path) => path.startsWith(`${hot.sourceDirectory}${sep}`)))) yield* Effect.forkScoped(hot.request(savedAt));
  const savedTypes = picked.changedModules.length === 0 ? Effect.void : types(ctx, picked.changedModules, savedAt);

  const unitsDone = Deferred.makeUnsafe<void>();
  const units = unitTests(ctx, picked.selection, savedAt).pipe(Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(unitsDone, Effect.void))));
  yield* Effect.all([savedTypes, units, allJourneys(ctx, picked.selection, savedAt, turns === undefined ? Effect.void : Deferred.await(unitsDone))], { concurrency: "unbounded", discard: true });
  ctx.savedDurations.save(ctx.durations);
});

const watchSources = (ctx: Context, events: Queue.Queue<string>, firstEvent: { at: number }) => Effect.gen(function*() {
  for (const directory of [...ctx.project.sources.map((source) => join(ctx.root, source)), ctx.root]) {
    const recursive = directory !== ctx.root;
    yield* Effect.acquireRelease(
      Effect.try({
        try: (): FSWatcher => watch(directory, { recursive }, (_, name) => {
          if (name === null) return;
          const path = join(directory, name.toString());
          if (!ctx.files.follows(path)) return;
          if (firstEvent.at === 0) firstEvent.at = ctx.now();
          Queue.offerUnsafe(events, path);
        }),
        catch: (cause) => new UsageFailure({ problem: `can't watch ${directory}: ${String(cause)}` }),
      }),
      (watcher) => Effect.sync(() => watcher.close()),
    );
  }
});

const waitForSaves = (ctx: Context, events: Queue.Queue<string>, firstEvent: { at: number }, start: Fiber.Fiber<void>) => Effect.gen(function*() {
  let current = start;
  return yield* Effect.forever(Effect.gen(function*() {
    const paths = new Set([yield* Queue.take(events)]);

    yield* Effect.sleep("10 millis");
    for (const path of yield* Queue.clear(events)) paths.add(path);
    const savedAt = firstEvent.at;
    firstEvent.at = 0;
    const changes = ctx.files.changes(paths);
    if (changes.changed.length + changes.created.length + changes.deleted.length === 0) return;
    yield* Fiber.interrupt(current);
    current = yield* Effect.forkScoped(run(ctx, changes, savedAt));
  }));
});

const git = (ctx: Context, args: readonly string[]) => runProcess(["git", ...args], ctx.root).pipe(Effect.flatMap(({ exitCode, output }) =>
  exitCode === 0 ? Effect.succeed(output) : Effect.fail(new UsageFailure({ problem: `git ${args.join(" ")}: ${output}` }))));

const runOnce = (ctx: Context, since: string) => Effect.gen(function*() {
  const top = (yield* git(ctx, ["rev-parse", "--show-toplevel"])).trim();
  const diff = yield* git(ctx, ["diff", "--name-only", "--no-renames", since, "--", "."]);
  const untracked = yield* git(ctx, ["ls-files", "--others", "--exclude-standard", "--full-name", "--", "."]);
  const paths = [...new Set(`${diff}\n${untracked}`.split("\n").filter((line) => line !== "").map((line) => resolve(top, line)))]
    .filter((path) => ctx.files.follows(path) && statSync(path, { throwIfNoEntry: false })?.isFile() === true);
  yield* Console.log(`ready in ${((ctx.now() - ctx.opened) / 1000).toFixed(3)} s; ${plural(paths.length, "changed file")} since ${since}`);
  if (paths.length === 0) return;
  const savedAt = ctx.now();
  yield* run(ctx, { changed: paths, created: [], deleted: [] }, savedAt);
  yield* Console.log(`${ctx.seconds(savedAt)}done`);
  if (ctx.problems.count > 0) return yield* new UsageFailure({ problem: `${plural(ctx.problems.count, "problem")} since ${since}` });
});

export const loop = (project: DevProject, hot: HotSide | undefined, now: Clock, since?: string) => Effect.scoped(Effect.gen(function*() {
  const ctx = yield* open(project, now, hot);
  for (const [path, why] of ctx.plan.alwaysRun()) yield* Console.log(`runs on every save: ${ctx.local(path)}: ${why}`);
  if (since !== undefined) return yield* runOnce(ctx, since);

  const events = yield* Effect.acquireRelease(Queue.unbounded<string>(), (queue) => Queue.shutdown(queue));
  const firstEvent = { at: 0 };
  yield* watchSources(ctx, events, firstEvent);
  if (hot !== undefined) yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep("50 millis"), hot.poll)));

  const first = yield* Effect.forkScoped(run(ctx, undefined, now()));
  yield* Console.log(`watching ${project.sources.join(", ")} in ${ctx.root}`);
  yield* Effect.forkScoped(waitForSaves(ctx, events, firstEvent, first));
  return yield* waitForProcessStop;
}));
