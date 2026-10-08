// `bun run test` (wisp:docs/testing.md): the whole suite, so that a failure
// means the code is wrong, never that the machine was busy.
//
// 1. Correctness tests run first, under whatever load the machine has; their
//    timeouts only catch hangs.
// 2. Timing tests (marked with timingTest, wisp:scripts/wisp/timingTest.ts)
//    run afterwards, alone, inside an exclusive machine-capacity lease this
//    runner takes, while it samples /proc/pressure/cpu. A timing test that
//    failed while CPU pressure was above BUSY_PRESSURE is inconclusive, not
//    failed: it runs again once the machine is quiet.
// 3. The last line is the machine's CPU pressure during the whole run.
//
// Usage: bun scripts/wisp/testRunner.ts [BUN_TEST_ARGS...]
// A consuming project runs its own suite the same way, from its root.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, Exit, Fiber, Option, Ref, Schedule, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TEST_PHASE_ENV, TIMING_TEST_PREFIX } from "./timingTest";

/**
 * CPU pressure (some avg10, percent) above which a timing test's failure says
 * nothing about the code. Measured on the 24-core development machine: other
 * agents usually hold it at 20-25%, and Wisp's timing tests passed at every
 * pressure measured, up to 77% under 48 extra one-core busy loops.
 */
export const BUSY_PRESSURE = 30;
/** Per-test bound: catches a hang, never a slow machine (10x the slowest test on a quiet machine). */
export const TEST_TIMEOUT_MS = 120_000;
/** Runs of a timing test before the runner gives up on a quiet machine. */
const TIMING_ATTEMPTS = 3;
/** How long the runner waits for the machine to quiet before a rerun. */
const QUIET_WAIT = "10 minutes";
/** Upper bound on one timing phase inside its exclusive lease. */
const LEASE_SECONDS = 1800;
/**
 * How long the runner queues for its exclusive lease. Other agents' batch
 * leases can hold it off for much longer; then the timing tests run without
 * it, and CPU pressure alone decides whether a failure counts.
 */
const LEASE_WAIT_MINUTES = 3;
/** Exit code when a timing test stayed inconclusive: nothing failed, nothing was shown fast enough. */
export const INCONCLUSIVE_EXIT = 75;

export class TestRunFailure extends Schema.TaggedError<TestRunFailure>()("TestRunFailure", {
  problem: Schema.String,
}) {
  override get message() {
    return this.problem;
  }
}

export interface CpuPressure {
  /** some avg10, percent. */
  readonly avg10: number;
  /** some total, microseconds any task waited for a CPU since boot. */
  readonly totalUs: number;
}

/** Reads /proc/pressure/cpu's "some" line. */
export function parseCpuPressure(text: string): CpuPressure | undefined {
  const some = /^some avg10=([\d.]+) avg60=[\d.]+ avg300=[\d.]+ total=(\d+)$/m.exec(text);
  return some === null ? undefined : { avg10: Number(some[1]), totalUs: Number(some[2]) };
}

interface Reading extends CpuPressure {
  readonly atMs: number;
}

/** Undefined where the kernel has no pressure information, as in some containers. */
const readPressure = Effect.sync((): Reading | undefined => {
  try {
    const pressure = parseCpuPressure(readFileSync("/proc/pressure/cpu", "utf8"));
    return pressure === undefined ? undefined : { ...pressure, atMs: performance.now() };
  } catch {
    return undefined;
  }
});

export interface PressureDuring {
  /** The highest some avg10 seen, percent; undefined without /proc/pressure/cpu. */
  readonly peak: number | undefined;
  /** Share of the time some task waited for a CPU, percent. */
  readonly average: number | undefined;
}

/** Runs `work` while sampling CPU pressure every half second. */
export const withPressure = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.gen(function*() {
  const first = yield* readPressure;
  const peak = yield* Ref.make(first?.avg10);
  const note = (reading: Reading | undefined) => Ref.update(peak, (highest) => reading === undefined ? highest : Math.max(highest ?? 0, reading.avg10));
  const sampler = yield* Effect.forkChild(readPressure.pipe(Effect.flatMap(note), Effect.repeat(Schedule.spaced("500 millis"))));
  const value = yield* work;
  yield* Fiber.interrupt(sampler);
  const last = yield* readPressure;
  yield* note(last);
  const average = first === undefined || last === undefined || last.atMs <= first.atMs
    ? undefined
    : ((last.totalUs - first.totalUs) / ((last.atMs - first.atMs) * 1000)) * 100;
  return { value, pressure: { peak: yield* Ref.get(peak), average } satisfies PressureDuring };
});

const percent = (value: number | undefined) => (value === undefined ? "unknown" : `${Math.round(value)}%`);

/** Runs a command on this terminal and returns its exit code; closing the scope stops its process group. */
const run = (command: string, args: readonly string[], env: Readonly<Record<string, string>> = {}) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.exitCode(ChildProcess.make(command, args, {
    env, extendEnv: true, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  }))).pipe(
    Effect.map(Number),
    Effect.mapError((failure) => new TestRunFailure({ problem: `${command} ${args.join(" ")}: ${failure.message}` })),
  );

/** bun test flags that take the next argument as their value. */
const VALUE_FLAGS = new Set(["-t", "--test-name-pattern", "--timeout", "--rerun-each", "--retry", "--reporter", "--reporter-outfile", "--preload", "--max-concurrency", "--parallel", "--path-ignore-patterns"]);

/** The path filters among bun test's arguments. */
export function pathFilters(args: readonly string[]): string[] {
  return args.filter((arg, index) => !arg.startsWith("-") && !VALUE_FLAGS.has(args[index - 1] ?? ""));
}

/** Test files under `root` that declare a timing test, matching bun test's path filters. */
export function timingTestFiles(root: string, filters: readonly string[]): string[] {
  const files: string[] = [];
  for (const file of new Bun.Glob("**/*{.test,_test,.spec,_spec}.{ts,tsx,js,jsx,mts,mjs}").scanSync(root)) {
    if (file.split("/").some((part) => part === "node_modules" || part === "build" || part.startsWith("."))) continue;
    if (filters.length > 0 && !filters.some((filter) => file.includes(filter.replace(/^\.\//, "")))) continue;
    if (readFileSync(join(root, file), "utf8").includes("timingTest(")) files.push(file);
  }
  return files.sort();
}

/** Written when the timing files start: the lease was admitted. */
const startedFile = (resultsFile: string) => `${resultsFile}.started`;

const TimingResult = Schema.Struct({ file: Schema.String, code: Schema.Int, peak: Schema.optionalKey(Schema.Finite), average: Schema.optionalKey(Schema.Finite) });
type TimingResult = typeof TimingResult.Type;
const decodeTimingResult = Schema.decodeUnknownEffect(Schema.fromJsonString(TimingResult));

/** Inside the lease: runs each timing file alone, writing one result line per file. */
const runTimingFiles = (resultsFile: string, files: readonly string[], args: readonly string[]) => Effect.gen(function*() {
  yield* Effect.sync(() => writeFileSync(startedFile(resultsFile), ""));
  const flags = args.filter((arg) => !pathFilters(args).includes(arg));
  for (const file of files) {
    const { value: code, pressure } = yield* withPressure(run(
      process.execPath,
      ["test", "--timeout", String(TEST_TIMEOUT_MS), ...flags, "-t", TIMING_TEST_PREFIX, `./${file}`],
      { [TEST_PHASE_ENV]: "timing" },
    ));
    const result: TimingResult = { file, code, ...(pressure.peak === undefined ? {} : { peak: pressure.peak }), ...(pressure.average === undefined ? {} : { average: pressure.average }) };
    yield* Effect.sync(() => appendFileSync(resultsFile, `${JSON.stringify(result)}\n`));
  }
});

/** The machine-capacity helper (the machine-capacity skill), or undefined where there is none, as on CI. */
const capacityHelper = Effect.gen(function*() {
  const given = process.env["WISP_CAPACITY_HELPER"];
  if (given !== undefined) return existsSync(given) ? given : undefined;
  const skill = yield* ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("agents", ["path", "machine-capacity"], { stderr: "ignore" }))).pipe(
    Effect.option,
  );
  const helper = Option.map(skill, (path) => join(dirname(path.trim()), "scripts/machine-capacity.mjs"));
  return Option.isSome(helper) && existsSync(helper.value) ? helper.value : undefined;
});

/** True inside a machine-capacity scope: an exclusive lease would wait for that very scope to end. */
const insideLease = Effect.sync(() => {
  try {
    return readFileSync("/proc/self/cgroup", "utf8").includes("agent-capacity");
  } catch {
    return false;
  }
});

/** One run of `files`, inside an exclusive lease when the machine has the helper. */
const timingPhase = (files: readonly string[], args: readonly string[], print: (line: string) => void) => Effect.acquireUseRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wisp-timing-"))),
  (directory) => Effect.gen(function*() {
    const resultsFile = join(directory, "results.jsonl");
    const helper = yield* capacityHelper;
    if (helper === undefined) {
      print("timing tests: no machine-capacity helper here; running them without a lease");
      yield* runTimingFiles(resultsFile, files, args);
    } else if (yield* insideLease) {
      print("timing tests: already inside a machine-capacity lease; running them in it (an exclusive lease would wait for it)");
      yield* runTimingFiles(resultsFile, files, args);
    } else {
      print(`timing tests: waiting for an exclusive machine-capacity lease for ${files.length} file${files.length === 1 ? "" : "s"}`);
      const leased = run(process.execPath, [
        helper, "run", "--class", "exclusive", "--owner", `wisp-test:${process.pid}`, "--timeout-seconds", String(LEASE_SECONDS),
        "--", process.execPath, import.meta.path, "--timing-run", resultsFile, ...files, "--", ...args,
      ]);
      // Other agents' batch work can hold the exclusive lease off: stop queueing after LEASE_WAIT_MINUTES.
      const admission = Effect.sync(() => existsSync(startedFile(resultsFile))).pipe(
        Effect.repeat({ schedule: Schedule.spaced("2 seconds"), until: (started) => started }),
        Effect.timeoutOption(`${LEASE_WAIT_MINUTES} minutes`),
        Effect.flatMap((started) => (Option.isSome(started) ? Effect.never : Effect.void)),
      );
      const code = yield* Effect.raceFirst(leased, admission);
      if (code === undefined) {
        print(`timing tests: no exclusive lease within ${LEASE_WAIT_MINUTES} minutes; running them without one, judged by CPU pressure`);
        yield* runTimingFiles(resultsFile, files, args);
      } else if (code !== 0) print(`timing tests: the capacity helper ended with ${code}`);
    }
    const text = existsSync(resultsFile) ? readFileSync(resultsFile, "utf8") : "";
    const results = yield* Effect.forEach(text.split("\n").filter((line) => line !== ""), (line) => decodeTimingResult(line).pipe(
      Effect.mapError((failure) => new TestRunFailure({ problem: `timing result ${line}: ${failure.message}` })),
    ));
    return new Map(results.map((result) => [result.file, result]));
  }),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
);

/** Waits, up to QUIET_WAIT, for some avg10 to fall to BUSY_PRESSURE; the last reading. */
const quiet = readPressure.pipe(
  Effect.repeat({ schedule: Schedule.spaced("5 seconds"), until: (reading) => reading === undefined || reading.avg10 <= BUSY_PRESSURE }),
  Effect.timeoutOption(QUIET_WAIT),
  Effect.flatMap((reading) => (Option.isSome(reading) ? Effect.succeed(reading.value) : readPressure)),
);

type Verdict = "passed" | "failed" | "inconclusive";

/** Timing files run until each passes, fails on a quiet machine, or runs out of attempts. */
const timingTests = (files: readonly string[], args: readonly string[], print: (line: string) => void) => Effect.gen(function*() {
  const verdicts = new Map<string, Verdict>();
  let pending = [...files];
  for (let attempt = 1; attempt <= TIMING_ATTEMPTS && pending.length > 0; attempt++) {
    if (attempt > 1) {
      print(`timing tests: waiting for CPU pressure to fall to ${BUSY_PRESSURE}% before rerunning ${pending.length}`);
      const reading = yield* quiet;
      print(`timing tests: CPU pressure ${percent(reading?.avg10)}; rerunning (attempt ${attempt} of ${TIMING_ATTEMPTS})`);
    }
    const results = yield* timingPhase(pending, args, print);
    const next: string[] = [];
    for (const file of pending) {
      const result = results.get(file);
      const pressure = `pressure ${percent(result?.peak)}`;
      if (result === undefined) {
        verdicts.set(file, "inconclusive");
        next.push(file);
        print(`timing ${file}: inconclusive: it did not run`);
      } else if (result.code === 0) {
        verdicts.set(file, "passed");
        print(`timing ${file}: passed (${pressure})`);
      } else if (result.peak !== undefined && result.peak > BUSY_PRESSURE) {
        verdicts.set(file, "inconclusive");
        next.push(file);
        print(`timing ${file}: inconclusive: machine busy (${pressure})`);
      } else {
        verdicts.set(file, "failed");
        print(`timing ${file}: FAILED on a quiet machine (${pressure})`);
      }
    }
    pending = next;
  }
  return verdicts;
});

/** The whole suite; succeeds with the process's exit code. */
export const runTests = (args: readonly string[], print: (line: string) => void = (line) => console.log(line)) => Effect.gen(function*() {
  const { value: summary, pressure } = yield* withPressure(Effect.gen(function*() {
    const correctness = yield* run(
      process.execPath,
      ["test", "--timeout", String(TEST_TIMEOUT_MS), "--pass-with-no-tests", ...args],
      { [TEST_PHASE_ENV]: "correctness" },
    );
    const files = timingTestFiles(process.cwd(), pathFilters(args));
    const verdicts = files.length === 0 ? new Map<string, Verdict>() : yield* timingTests(files, args, print);
    return { correctness, verdicts: [...verdicts.values()] };
  }));
  const count = (verdict: Verdict) => summary.verdicts.filter((value) => value === verdict).length;
  const timing = summary.verdicts.length === 0
    ? "no timing tests"
    : `timing tests: ${count("passed")} passed, ${count("failed")} failed, ${count("inconclusive")} inconclusive`;
  print(`correctness tests ${summary.correctness === 0 ? "passed" : "FAILED"}; ${timing}`);
  print(`CPU pressure during this run: average ${percent(pressure.average)}, peak some avg10 ${percent(pressure.peak)} (timing tests count as inconclusive above ${BUSY_PRESSURE}%)`);
  if (summary.correctness !== 0 || count("failed") > 0) return 1;
  return count("inconclusive") > 0 ? INCONCLUSIVE_EXIT : 0;
});

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const program: Effect.Effect<number, TestRunFailure, ChildProcessSpawner.ChildProcessSpawner> = argv[0] === "--timing-run"
    ? Effect.suspend(() => {
      const separator = argv.indexOf("--");
      const [, resultsFile = "", ...files] = separator < 0 ? argv : argv.slice(0, separator);
      return runTimingFiles(resultsFile, files, separator < 0 ? [] : argv.slice(separator + 1)).pipe(Effect.as(0));
    })
    : runTests(argv);
  BunRuntime.runMain(program.pipe(
    Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => console.error(Cause.pretty(cause))))),
    Effect.provide(BunServices.layer),
  ), {
    disableErrorReporting: true,
    teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : Cause.hasInterruptsOnly(exit.cause) ? 130 : 1),
  });
}
