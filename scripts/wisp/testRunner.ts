















import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, Exit, Fiber, Layer, Option, Ref, Schedule, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { platformLayer } from "../platform/layer";
import { type CpuPressure, ResourceAccounting } from "../platform/services";
import { TEST_COST_OUT_ENV, addCost, report, type Costs } from "./testCost";
import { TEST_PHASE_ENV, TIMING_TEST_PREFIX } from "./timingTest";







export const BUSY_PRESSURE = 30;

export const TEST_TIMEOUT_MS = 60_000;

const TIMING_ATTEMPTS = 3;

const QUIET_WAIT = "10 minutes";

const LEASE_SECONDS = 1800;





const LEASE_WAIT_MINUTES = 3;

export const INCONCLUSIVE_EXIT = 75;

export class TestRunFailure extends Schema.TaggedError<TestRunFailure>()("TestRunFailure", {
  problem: Schema.String,
}) {
  override get message() {
    return this.problem;
  }
}


interface Reading extends CpuPressure {
  readonly atMs: number;
}


const readPressure = ResourceAccounting.use((accounting) => Effect.sync((): Reading | undefined => {
  const pressure = accounting.cpuPressure();
  return pressure === undefined ? undefined : { ...pressure, atMs: performance.now() };
}));

export interface PressureDuring {

  readonly peak: number | undefined;

  readonly average: number | undefined;
}


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


const run = (command: string, args: readonly string[], env: Readonly<Record<string, string>> = {}) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.exitCode(ChildProcess.make(command, args, {
    env, extendEnv: true, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  }))).pipe(
    Effect.map(Number),
    Effect.mapError((failure) => new TestRunFailure({ problem: `${command} ${args.join(" ")}: ${failure.message}` })),
  );


const VALUE_FLAGS = new Set(["-t", "--test-name-pattern", "--timeout", "--rerun-each", "--retry", "--reporter", "--reporter-outfile", "--preload", "--max-concurrency", "--parallel", "--path-ignore-patterns"]);


export function pathFilters(args: readonly string[]): string[] {
  return args.filter((arg, index) => !arg.startsWith("-") && !VALUE_FLAGS.has(args[index - 1] ?? ""));
}


export function timingTestFiles(root: string, filters: readonly string[]): string[] {
  const files: string[] = [];
  for (const file of new Bun.Glob("**/*{.test,_test,.spec,_spec}.{ts,tsx,js,jsx,mts,mjs}").scanSync(root)) {
    if (file.split("/").some((part) => part === "node_modules" || part === "build" || part.startsWith("."))) continue;
    if (filters.length > 0 && !filters.some((filter) => file.includes(filter.replace(/^\.\//, "")))) continue;
    if (readFileSync(join(root, file), "utf8").includes("timingTest(")) files.push(file);
  }
  return files.sort();
}


const COST_PRELOAD = join(import.meta.dir, "testCostPreload.ts");


const startedFile = (resultsFile: string) => `${resultsFile}.started`;

const TimingResult = Schema.Struct({ file: Schema.String, code: Schema.Int, peak: Schema.optionalKey(Schema.Finite), average: Schema.optionalKey(Schema.Finite) });
type TimingResult = typeof TimingResult.Type;
const decodeTimingResult = Schema.decodeUnknownEffect(Schema.fromJsonString(TimingResult));


const runTimingFiles = (resultsFile: string, files: readonly string[], args: readonly string[]) => Effect.gen(function*() {
  yield* Effect.sync(() => writeFileSync(startedFile(resultsFile), ""));
  const flags = args.filter((arg) => !pathFilters(args).includes(arg));
  for (const [index, file] of files.entries()) {
    const reportFlags = flags.map((arg, position) => {
      const output = arg.startsWith("--reporter-outfile=") ? arg.slice("--reporter-outfile=".length)
        : flags[position - 1] === "--reporter-outfile" ? arg : undefined;
      if (output === undefined) return arg;
      const path = output.replace(/(\.[^./]+)?$/, `-timing-${index}$1`);
      return arg.startsWith("--reporter-outfile=") ? `--reporter-outfile=${path}` : path;
    });
    const { value: code, pressure } = yield* withPressure(run(
      process.execPath,
      ["test", "--timeout", String(TEST_TIMEOUT_MS), "--preload", COST_PRELOAD, ...reportFlags, "-t", TIMING_TEST_PREFIX, `./${file}`],
      { [TEST_PHASE_ENV]: "timing" },
    ));
    const result: TimingResult = { file, code, ...(pressure.peak === undefined ? {} : { peak: pressure.peak }), ...(pressure.average === undefined ? {} : { average: pressure.average }) };
    yield* Effect.sync(() => appendFileSync(resultsFile, `${JSON.stringify(result)}\n`));
  }
});


const capacityHelper = Effect.gen(function*() {
  const given = process.env["WISP_CAPACITY_HELPER"];
  if (given !== undefined) return existsSync(given) ? given : undefined;
  const skill = yield* ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("agents", ["path", "machine-capacity"], { stderr: "ignore" }))).pipe(
    Effect.option,
  );
  const helper = Option.map(skill, (path) => join(dirname(path.trim()), "scripts/machine-capacity.mjs"));
  return Option.isSome(helper) && existsSync(helper.value) ? helper.value : undefined;
});


const insideLease = ResourceAccounting.use((accounting) => Effect.sync(accounting.insideCapacityLease));


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


const quiet = readPressure.pipe(
  Effect.repeat({ schedule: Schedule.spaced("5 seconds"), until: (reading) => reading === undefined || reading.avg10 <= BUSY_PRESSURE }),
  Effect.timeoutOption(QUIET_WAIT),
  Effect.flatMap((reading) => (Option.isSome(reading) ? Effect.succeed(reading.value) : readPressure)),
);

export type Verdict = "passed" | "failed" | "inconclusive";





export const timingTests = (files: readonly string[], args: readonly string[], print: (line: string) => void) => Effect.gen(function*() {
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


const CostRow = Schema.Struct({
  unit: Schema.optionalKey(Schema.String),
  tests: Schema.optionalKey(Schema.Int),
  cpu: Schema.optionalKey(Schema.Finite),
  max: Schema.optionalKey(Schema.Finite),
  maxLuaInstructions: Schema.optionalKey(Schema.Finite),
  maxFrames: Schema.optionalKey(Schema.Finite),
});
const decodeCostRow = Schema.decodeUnknownEffect(Schema.fromJsonString(CostRow));



export const runTests = (args: readonly string[], print: (line: string) => void = (line) => console.log(line)) => Effect.acquireUseRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wisp-test-cost-"))),
  (directory) => Effect.gen(function*() {
    const costFile = join(directory, "costs.jsonl");
    const { value: summary, pressure } = yield* withPressure(Effect.gen(function*() {
      const correctness = yield* run(
        process.execPath,
        ["test", "--timeout", String(TEST_TIMEOUT_MS), "--pass-with-no-tests", "--preload", COST_PRELOAD, ...args],
        { [TEST_PHASE_ENV]: "correctness", [TEST_COST_OUT_ENV]: costFile },
      );
      const files = timingTestFiles(process.cwd(), pathFilters(args));
      const verdicts = files.length === 0 ? new Map<string, Verdict>() : yield* timingTests(files, args, print);
      return { correctness, verdicts: [...verdicts.values()] };
    }));
    const measured: Costs = new Map();
    const text = existsSync(costFile) ? readFileSync(costFile, "utf8") : "";
    for (const line of text.split("\n").filter((row) => row !== "")) {
      const row = yield* decodeCostRow(line).pipe(Effect.mapError((failure) => new TestRunFailure({ problem: `test cost row ${line}: ${failure.message}` })));
      if (row.unit !== undefined) addCost(measured, row.unit, row.tests ?? 0, row.cpu ?? 0, row.max ?? 0, row.maxLuaInstructions ?? 0, row.maxFrames ?? 0);
    }
    const costs = report("suite", measured);
    const count = (verdict: Verdict) => summary.verdicts.filter((value) => value === verdict).length;
    const timing = summary.verdicts.length === 0
      ? "no timing tests"
      : `timing tests: ${count("passed")} passed, ${count("failed")} failed, ${count("inconclusive")} inconclusive`;
    print(`correctness tests ${summary.correctness === 0 ? "passed" : "FAILED"}; ${timing}`);
    print(costs.heaviest);
    print(costs.deterministic);
    print(costs.summary);
    print(`CPU pressure during this run: average ${percent(pressure.average)}, peak some avg10 ${percent(pressure.peak)} (timing verdicts count as inconclusive above ${BUSY_PRESSURE}%)`);
    if (summary.correctness !== 0 || count("failed") > 0) return 1;
    return count("inconclusive") > 0 ? INCONCLUSIVE_EXIT : 0;
  }),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
);

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const program: Effect.Effect<number, TestRunFailure, ChildProcessSpawner.ChildProcessSpawner | ResourceAccounting> = argv[0] === "--timing-run"
    ? Effect.suspend(() => {
      const separator = argv.indexOf("--");
      const [, resultsFile = "", ...files] = separator < 0 ? argv : argv.slice(0, separator);
      return runTimingFiles(resultsFile, files, separator < 0 ? [] : argv.slice(separator + 1)).pipe(Effect.as(0));
    })
    : runTests(argv);
  BunRuntime.runMain(program.pipe(
    Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => console.error(Cause.pretty(cause))))),
    Effect.provide(Layer.merge(BunServices.layer, platformLayer())),
  ), {
    disableErrorReporting: true,
    teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : Cause.hasInterruptsOnly(exit.cause) ? 130 : 1),
  });
}
