import { type FSWatcher, statSync, watch } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { Console, Deferred, Effect, Fiber, Queue, Result, Schema, Semaphore } from "effect";
import { ResourceAccounting } from "../../platform/services";
import { UsageFailure, describeCause } from "../command";
import { Standby, runProcess } from "../devProcesses";
import { SAVED_FILES_ENV, WARM_ENV } from "../devResult";
import type { JourneyRequest } from "../journeyRun";
import type { RegistryRequest } from "../registryRun";
import type { WaitingTestRequest } from "../testWait";
import { waitForProcessStop } from "../hotReload";
import { type Changes, type Selection, TestPlan, type TestProcess, type TestUnit, packTests } from "../testSelection";
import { TypeChecker, formatTypeError } from "../typeCheck";
import type { DevProject } from "./project";
import { SavedDurations } from "./savedDurations";
import { SavedFiles } from "./savedFiles";
import { selectRun } from "./select";
import { type ProcessResult, counts, elapsedLabel, fileResult, indent, isRegistryResult, journeySummary, plural, registryResult, scope } from "./summary";

const REGISTRY_RUN = join(import.meta.dir, "../registryRun.ts");
const JOURNEY_RUN = join(import.meta.dir, "../journeyRun.ts");
const TEST_WAIT = join(import.meta.dir, "../testWait.ts");

const REGISTRY_STANDBY = 6;

const CONCURRENT_CPUS = 12;

const UNKNOWN_MS = { file: 300, registry: 40 };

export type Clock = () => number;

export interface HotSide {

  readonly request: (savedAt: number) => Effect.Effect<void>;

  readonly poll: Effect.Effect<void>;
  readonly sourceDirectory: string;
}

class TypeCheckFailure extends Schema.TaggedError<TypeCheckFailure>()("TypeCheckFailure", {
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `type checker: ${this.operation}: ${this.problem}`;
  }
}

const typeChecking = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new TypeCheckFailure({ operation, problem: describeCause(cause) }) });

const cpuBudget = (limit: number | undefined) => Math.max(1, Math.floor(Math.min(availableParallelism(), limit ?? Infinity)));

const open = (project: DevProject, now: Clock, hot: HotSide | undefined) => Effect.gen(function*() {
  const opened = now();
  const root = resolve(project.root);
  const problems = { count: 0 };
  const durations = new Map<string, number>();
  const savedDurations = new SavedDurations(root);
  savedDurations.load(durations);
  const cpus = cpuBudget((yield* ResourceAccounting).cpuLimit());
  const behind = Bun.which("nice") === null ? [] : ["nice", "-n", "10"];
  const unitProcesses = cpus < CONCURRENT_CPUS ? Math.max(1, cpus - 2) : Math.floor(cpus / 2) - 1;
  const checker = yield* Effect.acquireRelease(
    typeChecking(`open ${project.typeCheck.projects.join(", ")}`, () => TypeChecker.open(root, project.typeCheck.projects)),
    (opened) => Effect.promise(() => opened.close()),
  );
  const registry = yield* Standby.make([...behind, process.execPath, REGISTRY_RUN], root, Math.min(REGISTRY_STANDBY, unitProcesses), project.tests.env);
  const waiting = new Map<string, Standby>();
  for (const [file, modules] of Object.entries(project.tests.warm ?? {})) {
    waiting.set(resolve(root, file), yield* Standby.make([...behind, process.execPath, "test", TEST_WAIT], root, 1, { ...(project.tests.envForFiles?.([resolve(root, file)]) ?? project.tests.env), [WARM_ENV]: JSON.stringify(modules) }));
  }
  const journeys = project.journey === undefined ? undefined : yield* Standby.make([process.execPath, JOURNEY_RUN], root, 1);
  return {
    project,
    opened,
    hot,
    now,
    root,
    behind,
    unitProcesses,
    checker,
    registry,
    waiting,
    journeys,
    turns: cpus < CONCURRENT_CPUS ? Semaphore.makeUnsafe(Math.max(1, cpus - 1)) : undefined,
    files: new SavedFiles(root, project.sources),
    plan: new TestPlan(root, project.tests),
    preload: (project.tests.preload ?? []).map((path) => resolve(root, path)),
    durations,
    savedDurations,
    problems,
    problem: Effect.sync(() => {
      problems.count += 1;
    }),
    local: (path: string) => relative(root, path),
    seconds: (since: number) => elapsedLabel(now() - since),
  };
});

type Context = Effect.Success<ReturnType<typeof open>>;

const expected = (ctx: Context, unit: TestUnit) => ctx.durations.get(unit.path) ?? UNKNOWN_MS[unit.kind];

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

const wholeCheck = (ctx: Context, savedAt: number) => Effect.gen(function*() {
  const { exitCode, output } = yield* runProcess([...ctx.behind, ...ctx.project.typeCheck.command], ctx.root).pipe(
    Effect.catch((failure) => Effect.succeed({ exitCode: 1, output: failure.message })),
  );
  if (exitCode === 0) return yield* Console.log(`${ctx.seconds(savedAt)}types: no errors in the project`);
  yield* ctx.problem;
  yield* Console.log(`${ctx.seconds(savedAt)}types: the project check failed\n${indent(output)}`);
});

const runRegistry = (ctx: Context, batch: TestProcess) => Effect.gen(function*() {
  const request: RegistryRequest = { preload: ctx.preload, modules: batch.units.map((unit) => unit.path) };
  const output = yield* ctx.registry.run(request);
  for (const result of output.results.filter(isRegistryResult)) ctx.durations.set(result.module, result.milliseconds);
  return registryResult(batch.units, output, ctx.local);
});

const runFiles = (ctx: Context, batch: TestProcess, audits: ReadonlyMap<string, readonly string[]>) => Effect.gen(function*() {
  const { project, root, behind, local } = ctx;
  const started = ctx.now();
  const first = batch.units[0];
  const audited = batch.units.length === 1 ? audits.get(first?.path ?? "") : undefined;
  const savedFiles = audited === undefined ? {} : { [SAVED_FILES_ENV]: JSON.stringify(audited) };
  const standby = batch.units.length === 1 && first !== undefined ? ctx.waiting.get(first.path) : undefined;
  const paths = batch.units.map((unit) => unit.path);
  const output = standby === undefined
    ? yield* runProcess([...behind, process.execPath, "test", ...paths], root, { ...(project.tests.envForFiles?.(paths) ?? project.tests.env), ...savedFiles })
    : yield* standby.run({ file: first?.path ?? "", env: savedFiles } satisfies WaitingTestRequest);
  const elapsed = ctx.now() - started;

  if (audited !== undefined && first !== undefined) ctx.durations.set(`audit ${first.path}`, elapsed);
  else for (const unit of batch.units) ctx.durations.set(unit.path, (elapsed * expected(ctx, unit)) / Math.max(1, batch.work));
  return fileResult(batch.units.map((unit) => local(unit.path)).join(", "), output);
});

const runTests = (ctx: Context, batch: TestProcess, audits: ReadonlyMap<string, readonly string[]>): Effect.Effect<ProcessResult> =>
  (batch.kind === "registry" ? runRegistry(ctx, batch) : runFiles(ctx, batch, audits)).pipe(
    Effect.catch((failure) => Effect.succeed({ passed: 0, failures: [`${batch.units.map((unit) => ctx.local(unit.path)).join(", ")}: ${failure.message}`] })),
  );

const runSide = (ctx: Context, units: readonly TestUnit[], audits: ReadonlyMap<string, readonly string[]>, count: number, savedAt: number) => Effect.gen(function*() {
  const { plan, turns, durations, waiting } = ctx;
  const alone = (path: string) => audits.has(path) || waiting.has(path);
  const expectedHere = (unit: TestUnit) => (audits.has(unit.path) ? durations.get(`audit ${unit.path}`) ?? UNKNOWN_MS.file : expected(ctx, unit));
  const processes = packTests(units, expectedHere, (path) => (alone(path) ? `alone ${path}` : plan.group(path)), count)
    .sort((left, right) => right.work - left.work);
  const turn = (run: Effect.Effect<ProcessResult>) => (turns === undefined ? run : Semaphore.withPermit(turns, run));
  const results = yield* Effect.forEach(processes, (batch) => turn(runTests(ctx, batch, audits)).pipe(Effect.tap(({ failures }) =>
    failures.length === 0 ? Effect.void : Effect.andThen(ctx.problem, Console.log(`${ctx.seconds(savedAt)}FAIL ${failures.join(`\n${" ".repeat(13)}FAIL `)}`)))), { concurrency: "unbounded" });
  return {
    passed: results.reduce((sum, result) => sum + result.passed, 0),
    failed: results.reduce((sum, result) => sum + result.failures.length, 0),
  };
});

const unitTests = (ctx: Context, selection: Selection, savedAt: number) => Effect.gen(function*() {
  const units = selection.units.filter((unit) => !ctx.plan.isJourney(unit.path));
  if (units.length === 0) return yield* Console.log(`${ctx.seconds(savedAt)}unit tests: none load the saved files`);
  const { passed, failed } = yield* runSide(ctx, units, selection.audits ?? new Map(), ctx.unitProcesses, savedAt);
  const audited = [...selection.audits?.keys() ?? []].map(ctx.local);
  const audits = audited.length === 0 ? "" : `; ${audited.join(", ")} checked only the saved files`;
  yield* Console.log(`${ctx.seconds(savedAt)}unit tests: ${counts(passed, failed)} (${scope(units, selection, ctx.plan.all().length)}${audits})`);
});

const ownJourney = (ctx: Context) => Effect.gen(function*() {
  const { journey } = ctx.project;
  if (journey === undefined || ctx.journeys === undefined) return undefined;
  const { module, name, clients = 2 } = journey;
  const request: JourneyRequest = { module: resolve(ctx.root, module), export: journey.export, journey: name, clients };
  const ran = yield* ctx.journeys.run(request).pipe(Effect.result);
  if (Result.isFailure(ran)) return { summary: `${name} didn't finish`, report: ran.failure.message };
  return journeySummary(name, ran.success);
});

const allJourneys = (ctx: Context, selection: Selection, savedAt: number, before: Effect.Effect<void>) => Effect.gen(function*() {
  const units = selection.units.filter((unit) => ctx.plan.isJourney(unit.path));
  // @effect-diagnostics-next-line effectSucceedWithVoid:off -- an undefined result, which Effect.void's void type cannot satisfy
  const tests = units.length === 0 ? Effect.succeed(undefined) : runSide(ctx, units, new Map(), units.length, savedAt);
  yield* before;
  const [own, ran] = yield* Effect.all([ownJourney(ctx), tests], { concurrency: "unbounded" });
  if (own === undefined && ran === undefined) return;
  if (own?.report !== undefined) yield* ctx.problem;
  const parts = [
    ...(own === undefined ? [] : [own.summary]),
    ...(ran === undefined ? [] : [`${plural(ran.passed + ran.failed, "journey test")}: ${counts(ran.passed, ran.failed)} (${scope(units, selection, ctx.plan.all().length)})`]),
  ];
  yield* Console.log(`${ctx.seconds(savedAt)}journeys: ${parts.join("; ")}${own?.report === undefined ? "" : `\n${indent(own.report)}`}`);
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
  const answers = Effect.all([savedTypes, units, allJourneys(ctx, picked.selection, savedAt, turns === undefined ? Effect.void : Deferred.await(unitsDone))], { concurrency: "unbounded", discard: true });

  if (turns !== undefined) yield* Effect.andThen(answers, wholeCheck(ctx, savedAt));
  else yield* Effect.all([answers, wholeCheck(ctx, savedAt)], { concurrency: "unbounded", discard: true });
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
