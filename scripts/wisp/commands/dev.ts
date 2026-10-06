// `wisp dev`: one long-running command that answers every save
// (wisp:docs/dev.md). It keeps a TypeScript 7 checker, the project's test
// graph and processes for tests and a headless journey warm, and on each save
// reports three signals: the saved files' type errors, the unit tests the
// save can affect, and the journeys (the project's own in simulated clients
// and the affected journey tests); then the project's whole type check.
// With --data it also hot-reloads the map into running clients, as `hot
// --watch` does. Each result prints with its time since the save; a new save
// stops the previous one's work, except a hot reload, which finishes.
import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Console, Deferred, Effect, Fiber, Layer, Queue, Semaphore } from "effect";
import { type Command, type CommandFailure, UsageFailure, flagValues } from "../command";
import { Desyncs, formatDesync } from "../desyncs";
import { FrameCosts, formatFrameCost } from "../frameCosts";
import { type ProcessOutput, Standby, runProcess } from "../devProcesses";
import { SAVED_FILES_ENV, WARM_ENV } from "../devResult";
import { GameFiles } from "../gameFiles";
import { HotReload } from "../hotReload";
import type { JourneyOutcome, JourneyRequest } from "../journeyRun";
import { MapBuild } from "../mapBuild";
import type { RegistryRequest, RegistryResult } from "../registryRun";
import type { WaitingTestRequest } from "../testWait";
import { SourceErrors } from "../sourceErrors";
import { type Changes, type Selection, type TestDeclaration, type TestProcess, TestPlan, type TestUnit, packTests } from "../testSelection";
import { step } from "../timings";
import { TypeChecker, formatTypeError } from "../typeCheck";
import { type HotProject, validateDataDirectories, waitForProcessStop } from "./hot";

/** What a project declares for its dev loop; relative paths are under `root`. */
export interface DevProject {
  /** The project directory, where its tests and check command run. */
  readonly root: string;
  /** Directories whose saves start a run; the root's own tsconfig, package and lock files rerun everything. */
  readonly sources: readonly string[];
  readonly typeCheck: {
    /** tsconfig files whose programs check each saved file at once. */
    readonly projects: readonly string[];
    /** The project's whole type check, run after each save. */
    readonly command: readonly string[];
  };
  readonly tests: TestDeclaration;
  /** The headless journey played after each save: a module exporting the game's HeadlessProject, the export and the journey's name. */
  readonly journey?: { readonly module: string; readonly export: string; readonly name: string; readonly clients?: number };
  /** With --data, each save also hot-reloads this map into those clients. */
  readonly hot?: HotProject;
}

const REGISTRY_RUN = join(import.meta.dir, "../registryRun.ts");
const JOURNEY_RUN = join(import.meta.dir, "../journeyRun.ts");
const TEST_WAIT = join(import.meta.dir, "../testWait.ts");
/** Registry processes kept waiting for a save. */
const REGISTRY_STANDBY = 6;
/** CPUs from which the journey, the tests and the whole type check run at once rather than one after another. */
const CONCURRENT_CPUS = 12;
/** A test not seen before is expected to take this long. */
const UNKNOWN_MS = { file: 300, registry: 40 };
/** Files that rerun everything when they change at the root. */
const PROJECT_FILE = /^(?:tsconfig[^/]*\.json|package\.json|bunfig\.toml|[^/]*\.lock)$/;
/** Editors' swap, backup and probe files. */
const EDITOR_FILE = /^(?:\..*|.*~|.*\.sw[a-p]|4913)$/;
/** Lines of a failing test process's output that print. */
const OUTPUT_LINES = 40;

/** A file's text, or undefined when it can't be read. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** CPUs this process may keep busy: the machine's, or fewer under a Linux cgroup CPU quota. */
function cpuBudget(): number {
  let budget = availableParallelism();
  const own = readIfPresent("/proc/self/cgroup")?.split("\n").find((line) => line.startsWith("0::"))?.slice(3);
  if (own !== undefined) {
    for (let directory = join("/sys/fs/cgroup", own); directory.startsWith("/sys/fs/cgroup/"); directory = dirname(directory)) {
      const [quota, period] = readIfPresent(join(directory, "cpu.max"))?.trim().split(" ") ?? [];
      if (quota !== undefined && quota !== "max") budget = Math.min(budget, Number(quota) / Number(period));
    }
  }
  return Math.max(1, Math.floor(budget));
}

const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(3).padStart(8)} s  `;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const indent = (text: string) => text.split("\n").map((line) => `           ${line}`).join("\n");

/** Every file under the sources and the root's project files, by content, so a save that changes nothing runs nothing. */
class SavedFiles {
  private readonly hashes = new Map<string, number | bigint>();

  constructor(private readonly root: string, private readonly sources: readonly string[]) {
    for (const source of sources) {
      for (const path of new Bun.Glob("**/*").scanSync({ cwd: join(root, source), onlyFiles: true })) this.read(join(root, source, path));
    }
    for (const path of new Bun.Glob("*").scanSync({ cwd: root, onlyFiles: true })) if (PROJECT_FILE.test(path)) this.read(join(root, path));
  }

  /** Whether the dev loop follows `path`. */
  follows(path: string): boolean {
    const local = relative(this.root, path);
    if (local.startsWith("..") || EDITOR_FILE.test(basename(path)) || local.split(sep).includes("node_modules")) return false;
    return dirname(local) === "." ? PROJECT_FILE.test(local) : this.sources.some((source) => local.startsWith(`${source}${sep}`));
  }

  isProjectFile(path: string): boolean {
    return dirname(relative(this.root, path)) === ".";
  }

  /** What changed among `paths` since they were last seen. */
  changes(paths: Iterable<string>): Changes {
    const changed: string[] = [];
    const created: string[] = [];
    const deleted: string[] = [];
    for (const path of paths) {
      const known = this.hashes.get(path);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined) {
        if (known !== undefined) {
          this.hashes.delete(path);
          deleted.push(path);
        }
        continue;
      }
      if (!stat.isFile()) continue;
      const hash = this.read(path);
      if (known === undefined) created.push(path);
      else if (hash !== known) changed.push(path);
    }
    return { changed, created, deleted };
  }

  private read(path: string): number | bigint | undefined {
    try {
      const hash = Bun.hash(readFileSync(path));
      this.hashes.set(path, hash);
      return hash;
    } catch {
      return undefined;
    }
  }
}

interface ProcessResult {
  readonly passed: number;
  /** Failures to print, each a test and why. */
  readonly failures: readonly string[];
}

/** A Bun test process's count and, when it failed, its output. */
function fileResult(paths: string, { exitCode, output }: ProcessOutput): ProcessResult {
  const passed = Number(/^\s*(\d+) pass$/m.exec(output)?.[1] ?? 0);
  if (exitCode === 0) return { passed, failures: [] };
  const lines = output.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("bun test v"));
  const shown = lines.length > OUTPUT_LINES ? [...lines.slice(0, OUTPUT_LINES), `... ${lines.length - OUTPUT_LINES} more lines`] : lines;
  return { passed, failures: [`${paths} exited ${exitCode}:\n${shown.join("\n")}`] };
}

const isRegistryResult = (value: unknown): value is RegistryResult =>
  typeof value === "object" && value !== null && "module" in value && "passed" in value && "failures" in value;

/** A registry process's failures; a module it never reported failed to run. */
function registryResult(modules: readonly TestUnit[], { exitCode, results, output }: ProcessOutput, local: (path: string) => string): ProcessResult {
  const reported = new Map(results.filter(isRegistryResult).map((result) => [result.module, result]));
  let passed = 0;
  const failures: string[] = [];
  for (const unit of modules) {
    const result = reported.get(unit.path);
    if (result === undefined) {
      failures.push(`${local(unit.path)} didn't run: the test process exited ${exitCode}${output === "" ? "" : `:\n${output}`}`);
      continue;
    }
    passed += result.passed;
    for (const { test, message } of result.failures) failures.push(`${local(unit.path)} > ${test}: ${message}`);
  }
  return { passed, failures };
}

const isJourneyOutcome = (value: unknown): value is JourneyOutcome =>
  typeof value === "object" && value !== null && ("stopped" in value || ("lines" in value && "problems" in value));

/** The hot reload's part of the loop, when --data names clients. */
interface HotSide {
  /** Hot-reloads the saved code; a request during a reload makes one more afterwards. */
  readonly request: (savedAt: number) => Effect.Effect<void>;
  /** Prints new in-game error reports and desyncs. */
  readonly poll: Effect.Effect<void>;
  readonly sourceDirectory: string;
}

const loop = (project: DevProject, hot: HotSide | undefined) => Effect.scoped(Effect.gen(function*() {
  const root = resolve(project.root);
  const local = (path: string) => relative(root, path);
  const files = new SavedFiles(root, project.sources);
  const plan = new TestPlan(root, project.tests);
  const preload = (project.tests.preload ?? []).map((path) => resolve(root, path));
  const durations = new Map<string, number>();
  const expected = (unit: TestUnit) => durations.get(unit.path) ?? UNKNOWN_MS[unit.kind];
  const cpus = cpuBudget();
  // Tests and the whole check yield the CPUs to the journey and the saved files' check when they compete.
  const behind = Bun.which("nice") === null ? [] : ["nice", "-n", "10"];
  // A test process keeps about two CPUs busy beside the journey and the saved
  // files' check. Under a quota, work beyond it stalls every process, so the
  // signals run in deadline order (the saved files' check and the unit tests,
  // then the journeys, then the whole check) and test processes take turns.
  const unitProcesses = cpus < CONCURRENT_CPUS ? Math.max(1, cpus - 2) : Math.floor(cpus / 2) - 1;
  const turns = cpus < CONCURRENT_CPUS ? Semaphore.makeUnsafe(Math.max(1, cpus - 1)) : undefined;
  const checker = yield* Effect.acquireRelease(
    Effect.promise(() => TypeChecker.open(root, project.typeCheck.projects)),
    (opened) => Effect.promise(() => opened.close()),
  );
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() => new Standby([...behind, process.execPath, REGISTRY_RUN], root, Math.min(REGISTRY_STANDBY, unitProcesses), project.tests.env)),
    (standby) => Effect.sync(() => standby.close()),
  );
  const waiting = new Map<string, Standby>();
  for (const [file, modules] of Object.entries(project.tests.warm ?? {})) {
    waiting.set(resolve(root, file), yield* Effect.acquireRelease(
      Effect.sync(() => new Standby([...behind, process.execPath, "test", TEST_WAIT], root, 1, { ...project.tests.env, [WARM_ENV]: JSON.stringify(modules) })),
      (standby) => Effect.sync(() => standby.close()),
    ));
  }
  const journeys = project.journey === undefined ? undefined : yield* Effect.acquireRelease(
    Effect.sync(() => new Standby([process.execPath, JOURNEY_RUN], root, 1)),
    (standby) => Effect.sync(() => standby.close()),
  );

  const types = (changed: readonly string[], savedAt: number) => Effect.gen(function*() {
    const result = yield* Effect.promise(() => checker.check(changed));
    if (result.files.length === 0) return;
    const checked = result.files.map(local).join(", ");
    if (result.errors.length === 0) return yield* Console.log(`${seconds(savedAt)}types: no errors in ${checked}`);
    yield* Console.log(`${seconds(savedAt)}types: ${plural(result.errors.length, "error")} in ${checked}\n${result.errors.map((error) => indent(formatTypeError(root, error))).join("\n")}`);
  });

  const wholeCheck = (savedAt: number) => Effect.gen(function*() {
    const { exitCode, output } = yield* runProcess([...behind, ...project.typeCheck.command], root);
    if (exitCode === 0) return yield* Console.log(`${seconds(savedAt)}types: no errors in the project`);
    yield* Console.log(`${seconds(savedAt)}types: the project check failed\n${indent(output)}`);
  });

  const runTests = (process: TestProcess, audits: ReadonlyMap<string, readonly string[]>) => Effect.gen(function*() {
    if (process.kind === "registry") {
      const request: RegistryRequest = { preload, modules: process.units.map((unit) => unit.path) };
      const output = yield* registry.run(request);
      for (const result of output.results.filter(isRegistryResult)) durations.set(result.module, result.milliseconds);
      return registryResult(process.units, output, local);
    }
    const started = Date.now();
    // A per-file audit runs alone, so its saved files are its own.
    const audited = process.units.length === 1 ? audits.get(process.units[0]?.path ?? "") : undefined;
    const savedFiles = audited === undefined ? {} : { [SAVED_FILES_ENV]: JSON.stringify(audited) };
    const first = process.units[0];
    const standby = process.units.length === 1 && first !== undefined ? waiting.get(first.path) : undefined;
    const output = standby === undefined
      ? yield* runProcess([...behind, globalThis.process.execPath, "test", ...process.units.map((unit) => unit.path)], root, { ...project.tests.env, ...savedFiles })
      : yield* standby.run({ file: first?.path ?? "", env: savedFiles } satisfies WaitingTestRequest);
    const elapsed = Date.now() - started;
    // An audit of saved files is timed apart from a whole one; a shared process's time is split by what each file was expected to take.
    if (audited !== undefined && first !== undefined) durations.set(`audit ${first.path}`, elapsed);
    else for (const unit of process.units) durations.set(unit.path, (elapsed * expected(unit)) / Math.max(1, process.work));
    return fileResult(process.units.map((unit) => local(unit.path)).join(", "), output);
  });

  /** Runs tests in about `count` processes; failures print as they land. */
  const runSide = (units: readonly TestUnit[], audits: ReadonlyMap<string, readonly string[]>, count: number, savedAt: number) => Effect.gen(function*() {
    // An audit's saved files and a waiting process are one file's own.
    const alone = (path: string) => audits.has(path) || waiting.has(path);
    const expectedHere = (unit: TestUnit) => (audits.has(unit.path) ? durations.get(`audit ${unit.path}`) ?? UNKNOWN_MS.file : expected(unit));
    const processes = packTests(units, expectedHere, (path) => (alone(path) ? `alone ${path}` : plan.group(path)), count)
      .sort((left, right) => right.work - left.work);
    const turn = (run: Effect.Effect<ProcessResult>) => (turns === undefined ? run : Semaphore.withPermit(turns, run));
    const results = yield* Effect.forEach(processes, (process) => turn(runTests(process, audits)).pipe(Effect.tap(({ failures }) =>
      failures.length === 0 ? Effect.void : Console.log(`${seconds(savedAt)}FAIL ${failures.join(`\n${" ".repeat(13)}FAIL `)}`))), { concurrency: "unbounded" });
    return {
      passed: results.reduce((sum, result) => sum + result.passed, 0),
      failed: results.reduce((sum, result) => sum + result.failures.length, 0),
    };
  });

  const counts = (passed: number, failed: number) => `${failed === 0 ? "" : `${plural(failed, "failure")}, `}${passed} passed`;
  const scope = (units: readonly TestUnit[], selection: Selection) => (selection.full === undefined
    ? `${plural(units.length, "test file")} of ${plan.all().length} affected`
    : `${plural(units.length, "test file")}, all: ${selection.full}`);

  const unitTests = (selection: Selection, savedAt: number) => Effect.gen(function*() {
    const units = selection.units.filter((unit) => !plan.isJourney(unit.path));
    if (units.length === 0) return yield* Console.log(`${seconds(savedAt)}unit tests: none load the saved files`);
    const { passed, failed } = yield* runSide(units, selection.audits ?? new Map(), unitProcesses, savedAt);
    const audited = [...selection.audits?.keys() ?? []].map(local);
    const audits = audited.length === 0 ? "" : `; ${audited.join(", ")} checked only the saved files`;
    yield* Console.log(`${seconds(savedAt)}unit tests: ${counts(passed, failed)} (${scope(units, selection)}${audits})`);
  });

  /** The project's own journey: what to print in the journeys line, and its report when it found problems. */
  const ownJourney = Effect.gen(function*() {
    if (project.journey === undefined || journeys === undefined) return undefined;
    const { module, name, clients = 2 } = project.journey;
    const request: JourneyRequest = { module: resolve(root, module), export: project.journey.export, journey: name, clients };
    const output = yield* journeys.run(request);
    const outcome = output.results.find(isJourneyOutcome);
    if (outcome === undefined) return { summary: `${name} didn't finish`, report: `exited ${output.exitCode}\n${output.output}` };
    if ("stopped" in outcome) return { summary: `${name} stopped`, report: outcome.stopped };
    if (outcome.problems === 0) return { summary: `${name} passed` };
    return { summary: `${name}: ${plural(outcome.problems, "problem")}`, report: outcome.lines.join("\n") };
  });

  /**
   * The journey tests a save affects, each in its own process, beside the
   * project's own journey: one line when both end. Both start after `before`.
   */
  const allJourneys = (selection: Selection, savedAt: number, before: Effect.Effect<void>) => Effect.gen(function*() {
    const units = selection.units.filter((unit) => plan.isJourney(unit.path));
    const tests = units.length === 0 ? Effect.succeed(undefined) : runSide(units, new Map(), units.length, savedAt);
    yield* before;
    const [own, ran] = yield* Effect.all([ownJourney, tests], { concurrency: "unbounded" });
    if (own === undefined && ran === undefined) return;
    const parts = [
      ...(own === undefined ? [] : [own.summary]),
      ...(ran === undefined ? [] : [`${plural(ran.passed + ran.failed, "journey test")}: ${counts(ran.passed, ran.failed)} (${scope(units, selection)})`]),
    ];
    yield* Console.log(`${seconds(savedAt)}journeys: ${parts.join("; ")}${own?.report === undefined ? "" : `\n${indent(own.report)}`}`);
  });

  /** Everything one save runs; `changes` is undefined for the first run, which runs every test. */
  const run = (changes: Changes | undefined, savedAt: number) => Effect.gen(function*() {
    const saved = changes === undefined ? [] : [...changes.changed, ...changes.created, ...changes.deleted];
    const projectFiles = saved.filter((path) => files.isProjectFile(path));
    if (changes !== undefined && (projectFiles.length > 0 || changes.created.length > 0 || changes.deleted.length > 0)) {
      yield* Effect.promise(() => checker.reopen());
    }
    const selection: Selection = changes === undefined
      ? { units: plan.all(), full: "the first run" }
      : projectFiles.length > 0
        ? plan.everything(`${projectFiles.map(local).join(", ")} changed`)
        : plan.select(changes);
    yield* Console.log(changes === undefined ? "first run" : `saved ${saved.map(local).join(", ")}`);
    if (projectFiles.some((path) => /(?:package\.json|\.lock)$/.test(path))) {
      yield* Console.log("packages changed: restart wisp dev to load them");
    }
    const changedModules = changes?.changed.filter((path) => !files.isProjectFile(path)) ?? [];
    // As `hot --watch` does, the first run publishes the map too.
    if (hot !== undefined && (changes === undefined || saved.some((path) => path.startsWith(`${hot.sourceDirectory}${sep}`)))) yield* Effect.forkScoped(hot.request(savedAt));
    const savedTypes = changedModules.length === 0 ? Effect.void : types(changedModules, savedAt);
    // Under a quota the journeys wait for the unit tests, so those have the CPUs.
    const unitsDone = Deferred.makeUnsafe<void>();
    const units = unitTests(selection, savedAt).pipe(Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(unitsDone, Effect.void))));
    const answers = Effect.all([savedTypes, units, allJourneys(selection, savedAt, turns === undefined ? Effect.void : Deferred.await(unitsDone))], { concurrency: "unbounded", discard: true });
    // Under a quota the whole check waits for the answers above.
    if (turns !== undefined) yield* Effect.andThen(answers, wholeCheck(savedAt));
    else yield* Effect.all([answers, wholeCheck(savedAt)], { concurrency: "unbounded", discard: true });
  });

  for (const [path, why] of plan.alwaysRun()) yield* Console.log(`runs on every save: ${local(path)}: ${why}`);

  // Saves arrive as file events; a batch of events 10 ms apart is one save.
  const events = yield* Effect.acquireRelease(Queue.unbounded<string>(), (queue) => Queue.shutdown(queue));
  const firstEvent = { at: 0 };
  for (const directory of [...project.sources.map((source) => join(root, source)), root]) {
    const recursive = directory !== root;
    yield* Effect.acquireRelease(
      Effect.try({
        try: (): FSWatcher => watch(directory, { recursive }, (_, name) => {
          if (name === null) return;
          const path = join(directory, name.toString());
          if (!files.follows(path)) return;
          if (firstEvent.at === 0) firstEvent.at = Date.now();
          Queue.offerUnsafe(events, path);
        }),
        catch: (cause) => new UsageFailure({ problem: `can't watch ${directory}: ${String(cause)}` }),
      }),
      (watcher) => Effect.sync(() => watcher.close()),
    );
  }
  if (hot !== undefined) yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep("50 millis"), hot.poll)));

  let current: Fiber.Fiber<void> | undefined = yield* Effect.forkScoped(run(undefined, Date.now()));
  yield* Console.log(`watching ${project.sources.join(", ")} in ${root}`);
  const worker = Effect.forever(Effect.gen(function*() {
    const paths = new Set([yield* Queue.take(events)]);
    // An editor's save can be several events; they make one change.
    yield* Effect.sleep("10 millis");
    for (const path of yield* Queue.clear(events)) paths.add(path);
    const savedAt = firstEvent.at;
    firstEvent.at = 0;
    const changes = files.changes(paths);
    if (changes.changed.length + changes.created.length + changes.deleted.length === 0) return;
    if (current !== undefined) yield* Fiber.interrupt(current);
    current = yield* Effect.forkScoped(run(changes, savedAt));
  }));
  yield* Effect.forkScoped(worker);
  yield* waitForProcessStop;
}));

/** `dev [--data DIR ...]`: the dev loop, hot-reloading into those clients when --data names them. */
export const makeDev = (project: DevProject): Command => (args) => Effect.gen(function*() {
  const data = flagValues(args, "data");
  if (data.length === 0) return yield* loop(project, undefined);
  const hotProject = project.hot;
  if (hotProject === undefined) return yield* new UsageFailure({ problem: "this project declares no map to hot-reload" });
  const directories = yield* validateDataDirectories(data);
  const services = HotReload.layer(directories, hotProject.filePrefix).pipe(
    Layer.provideMerge(MapBuild.layer(hotProject.project)),
    Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory: hotProject.sourceMapDirectory, filePrefix: hotProject.filePrefix ?? "wisp" })),
    Layer.merge(Desyncs.layer(directories)),
    Layer.provideMerge(FrameCosts.layer(hotProject.filePrefix)),
    Layer.provideMerge(GameFiles.layer()),
  );
  yield* Effect.gen(function*() {
    const reload = yield* HotReload;
    const sourceErrors = yield* SourceErrors;
    const desyncs = yield* Desyncs;
    const frameCosts = yield* FrameCosts;
    // Reports from before the loop started are old news.
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
        const desync = yield* desyncs.changed;
        if (desync !== undefined) yield* Console.log(formatDesync(desync));
        const reports = yield* sourceErrors.changed(directories);
        yield* Effect.forEach(reports, (found) =>
          Console.log(`p${found.slot} ${found.heading} (${found.latency.toFixed(0)} ms after the game wrote it)\n${found.text}`), { discard: true });
        const costs = yield* frameCosts.changed(directories);
        yield* Effect.forEach(costs, ({ slot, report: cost }) => Console.log(formatFrameCost(slot, cost, hotProject.frameCostThreshold)), { discard: true });
      })),
    };
    yield* loop(project, hot);
  }).pipe(Effect.provide(services));
});
