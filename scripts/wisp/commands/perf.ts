// `wisp perf`: plays one of the game's runs with its map's compiled bundle in
// 32-bit Lua and measures every frame (wisp:docs/frame-cost.md#headless);
// `wisp perf compare A B` compares two such runs and fails when B is worse;
// `wisp perf native` and `wisp perf fit` hold predictions to native overlay
// readings (wisp:docs/frame-cost.md#checking-against-warcraft).
import { join } from "node:path";
import { Cause, Clock, Console, Effect, Exit, Option, Schema } from "effect";
import { mapCompiler, report } from "../../compiler";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { DEFAULT_PERF_THRESHOLD, comparePerfRuns, parsePerfRun, predictionLines } from "../perf";
import { step } from "../timings";
import { emitJson } from "../jsonResults";
import { type NativeCase, checkNative, fitNativeCost, nativeCheckLines, parseNativeReadings, parsePerfSamples } from "../nativeFit";
import { type NativeCostModel, WARCRAFT_COST } from "../../../src/headless/nativeCost";

/** A tsconfig and the Lua bundle it writes. */
export interface LuaBuild {
  readonly config: string;
  readonly bundle: string;
}

export interface PerfProject {
  /** The map whose frames are measured, as the development build compiles it. */
  readonly map: LuaBuild;
  /**
   * The Lua program that plays and measures: it calls runLuaPerf or
   * runLuaPerfWith with the map's bundle and declarations, its first two
   * arguments; then the run's name, the frames to play and "samples" when
   * every frame should print.
   */
  readonly program: LuaBuild;
  /** warcraft.d.ts; the package's by default. */
  readonly declarations?: string;
  /** The run `perf` plays without a name; "journey" by default. */
  readonly defaultRun?: string;
  /** Other runs the program plays, by name, each with the map it measures. */
  readonly runs?: Readonly<Record<string, LuaBuild>>;
}

export class PerfFailure extends Schema.TaggedError<PerfFailure>()("PerfFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const compile = (build: LuaBuild) => Effect.try({
  try: () => report(mapCompiler(build.config)()),
  catch: (cause) => new PerfFailure({ problem: `compiling ${build.config}: ${describeCause(cause)}` }),
}).pipe(Effect.flatMap((problems) => (problems === "" ? Effect.void : Effect.fail(new PerfFailure({ problem: problems })))));

const readRun = (path: string) => Effect.tryPromise({
  try: async () => parsePerfRun(await Bun.file(path).text()),
  catch: (cause) => new PerfFailure({ problem: `${path}: ${describeCause(cause)}` }),
});

interface PerfOutput {
  readonly json: boolean;
  readonly result: (data: Readonly<Record<string, unknown>>) => Effect.Effect<void>;
  failureKind: "error" | "check-fail" | "budget";
}

const runData = (run: ReturnType<typeof parsePerfRun>) => ({
  frames: run.frames, step: run.step, problems: run.problems, collector: run.collector,
  clients: [...run.clients].map(([client, metrics]) => ({ client, metrics })),
});

const compare = (output: PerfOutput): Command => (args) => Effect.gen(function*() {
  const [thresholdText = String(DEFAULT_PERF_THRESHOLD)] = flagValues(args, "threshold");
  const paths = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--threshold");
  const threshold = Number(thresholdText);
  const [a, b] = paths;
  if (a === undefined || b === undefined || paths.length !== 2 || !(threshold >= 0)) {
    return yield* new UsageFailure({ problem: "perf compare takes two runs and an optional --threshold share, such as 0.05" });
  }
  const before = yield* readRun(a);
  const after = yield* readRun(b);
  const comparison = comparePerfRuns(before, after, threshold);
  if (output.json) yield* output.result({ before: runData(before), after: runData(after), threshold, regressions: comparison.regressions });
  else yield* Console.log(comparison.lines.join("\n"));
  if (comparison.regressions.length > 0) {
    output.failureKind = "budget";
    return yield* new PerfFailure({ problem: `B is worse than A by more than ${threshold * 100}%: ${comparison.regressions.join("; ")}` });
  }
  if (!output.json) yield* Console.log(`B is no worse than A beyond ${threshold * 100}%`);
});

/** Frames a named run plays unless --frames says otherwise. */
const DEFAULT_FRAMES = 1800;

/** The runs a project's perf program plays, by name, each with its map. */
const projectRuns = (project: PerfProject): Readonly<Record<string, LuaBuild>> => ({ [project.defaultRun ?? "journey"]: project.map, ...project.runs });

/** Compiles the run's map and the perf program, plays the run in 32-bit Lua, and returns what it printed and its frames read back. */
export const measureRun = (project: PerfProject, name: string, frames: number, samples: boolean) => Effect.gen(function*() {
  const map = projectRuns(project)[name];
  if (map === undefined) return yield* new PerfFailure({ problem: `no perf run named ${name}` });
  yield* compile(map).pipe(step("compile map"));
  yield* compile(project.program).pipe(step("compile perf program"));
  const declarations = project.declarations ?? join(import.meta.dir, "../../../src/natives/warcraft.d.ts");
  const lua = process.env.LUA ?? "lua";
  const run = yield* Effect.try({
    try: () => Bun.spawnSync([lua, project.program.bundle, map.bundle, declarations, name, String(frames), ...(samples ? ["samples"] : [])], { stdout: "pipe", stderr: "pipe" }),
    catch: (cause) => new PerfFailure({ problem: `running ${lua}: ${describeCause(cause)}` }),
  }).pipe(step(`${name} in 32-bit Lua`));
  const output = run.stdout.toString();
  const summary = output.split("\n").filter((line) => !line.startsWith("frame ")).join("\n").trimEnd();
  if (run.exitCode !== 0) return yield* new PerfFailure({ problem: `${lua} exited ${run.exitCode}: ${run.stderr.toString()}${summary}` });
  const measured = yield* Effect.try({ try: () => parsePerfRun(output), catch: (cause) => new PerfFailure({ problem: describeCause(cause) }) });
  return { output, summary, measured };
});

const readText = (path: string) => Effect.tryPromise({
  try: () => Bun.file(path).text(),
  catch: (cause) => new PerfFailure({ problem: `${path}: ${describeCause(cause)}` }),
});

/** One case: a headless run's samples (`perf --samples` output) and the overlay readings of the native run it stands for. */
const readCase = (samplesText: string, readingsPath: string, slot: number) => Effect.gen(function*() {
  const frames = parsePerfSamples(samplesText).get(slot);
  if (frames === undefined || frames.length === 0) return yield* new PerfFailure({ problem: `the samples have no frames of p${slot}: run perf with --samples` });
  const text = yield* readText(readingsPath);
  const readings = yield* Effect.try({ try: () => parseNativeReadings(text), catch: (cause) => new PerfFailure({ problem: `${readingsPath}: ${describeCause(cause)}` }) });
  return { name: readingsPath, frames, readings } satisfies NativeCase;
});

const modelLine = (model: NativeCostModel) =>
  `model: Lua factor ${model.luaFactor.toFixed(2)} x ${model.hostUsPerThousandInstructions.toFixed(1)} µs per 1000 instructions, native call ${model.nativeCallUs} µs, collector ${model.collectorUsPerKb} µs per KB, typing ${model.typingUsPerCharacterSquared} µs per character squared`;

/**
 * `perf native READINGS [RUN] [--samples FILE] [--slot N]`: the run's
 * predicted overlay against a native session's readings of the same build;
 * fails unless median and p95 are within 20%. Without --samples it plays RUN.
 */
const native = (project: PerfProject, output: PerfOutput): Command => (args) => Effect.gen(function*() {
  const [samples] = flagValues(args, "samples");
  const [slotText = "0"] = flagValues(args, "slot");
  const [framesText = String(DEFAULT_FRAMES)] = flagValues(args, "frames");
  const named = args.filter((arg, index) => !arg.startsWith("--") && !["--samples", "--slot", "--frames"].includes(args[index - 1] ?? ""));
  const [readings, name = project.defaultRun ?? "journey"] = named;
  if (readings === undefined || named.length > 2) return yield* new UsageFailure({ problem: "perf native takes the native readings (a session's bot-result.json), then a run, or --samples FILE" });
  const samplesText = samples === undefined ? (yield* measureRun(project, name, Number(framesText), true)).output : yield* readText(samples);
  const check = checkNative(WARCRAFT_COST, yield* readCase(samplesText, readings, Number(slotText)));
  if (output.json) yield* output.result({ model: WARCRAFT_COST, ...check });
  else yield* Console.log([modelLine(WARCRAFT_COST), ...nativeCheckLines(check)].join("\n"));
  if (!check.passed) {
    output.failureKind = "check-fail";
    return yield* new PerfFailure({ problem: "the prediction misses native by more than 20%, or the readings show no p95" });
  }
});

/**
 * `perf fit SAMPLES=READINGS ... [--slot N]`: the native call and collector
 * costs fitted to every case, each case's error under them, and with two or
 * more cases each one's error under a fit to the others (held out).
 */
const fit = (output: PerfOutput): Command => (args) => Effect.gen(function*() {
  const [slotText = "0"] = flagValues(args, "slot");
  const pairs = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--slot");
  if (pairs.length === 0 || pairs.some((pair) => !pair.includes("="))) return yield* new UsageFailure({ problem: "perf fit takes SAMPLES=READINGS pairs: a run's perf --samples output and its native overlay readings" });
  const cases = yield* Effect.forEach(pairs, (pair) => readText(pair.slice(0, pair.indexOf("="))).pipe(Effect.flatMap((text) => readCase(text, pair.slice(pair.indexOf("=") + 1), Number(slotText)))));
  const fitted = fitNativeCost(WARCRAFT_COST, cases);
  const lines = [`fitted to all ${cases.length}: ${modelLine(fitted)}`];
  for (const item of cases) {
    const check = checkNative(fitted, item);
    if (output.json) yield* output.result({ fit: "all", model: fitted, ...check });
    else lines.push(...nativeCheckLines(check));
  }
  if (cases.length > 1) {
    for (const item of cases) {
      const others = fitNativeCost(WARCRAFT_COST, cases.filter((other) => other !== item));
      const check = checkNative(others, item);
      if (output.json) yield* output.result({ fit: "held-out", model: others, ...check });
      else {
        lines.push(`held out ${item.name}, fitted to the others: native call ${others.nativeCallUs} µs, collector ${others.collectorUsPerKb} µs per KB`);
        lines.push(...nativeCheckLines(check));
      }
    }
  }
  if (!output.json) yield* Console.log(lines.join("\n"));
});


/** `perf [RUN] [--frames N] [--samples] [--out FILE]` and `perf compare A B [--threshold SHARE]`. */
const perf = (project: PerfProject, output: PerfOutput): Command => (args) => Effect.gen(function*() {
  if (args[0] === "compare") return yield* compare(output)(args.slice(1));
  if (args[0] === "native") return yield* native(project, output)(args.slice(1));
  if (args[0] === "fit") return yield* fit(output)(args.slice(1));
  const [out] = flagValues(args, "out");
  const [framesText = String(DEFAULT_FRAMES)] = flagValues(args, "frames");
  const named = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--out" && args[index - 1] !== "--frames");
  const runs = projectRuns(project);
  const name = named[0] ?? project.defaultRun ?? "journey";
  const frames = Number(framesText);
  if (named.length > 1 || runs[name] === undefined || !Number.isInteger(frames) || frames < 1) {
    return yield* new UsageFailure({ problem: `perf takes one run (${Object.keys(runs).join(", ")}), --frames N, --samples and --out FILE; or compare A B; native READINGS [RUN]; fit SAMPLES=READINGS ...` });
  }
  const { output: stdout, summary, measured } = yield* measureRun(project, name, frames, args.includes("--samples"));
  if (out !== undefined) yield* Effect.tryPromise({ try: () => Bun.write(out, stdout), catch: (cause) => new PerfFailure({ problem: `writing ${out}: ${describeCause(cause)}` }) });
  if (output.json) yield* output.result({ name, ...runData(measured) });
  else {
    yield* Console.log(summary);
    yield* Console.log(predictionLines(measured).join("\n"));
  }
  if (measured.problems > 0) {
    output.failureKind = "check-fail";
    return yield* new PerfFailure({ problem: `the run found ${measured.problems} problem(s); its frames are not a measurement` });
  }
});

/** JSON Lines contain measurements, a failure when present, and one final summary. */
export const makePerf = (project: PerfProject): Command => (args) => Effect.gen(function*() {
  const json = args.includes("--json");
  const clean = args.filter((arg) => arg !== "--json");
  const command = ["compare", "native", "fit"].includes(clean[0] ?? "") ? `perf ${clean[0]}` : "perf";
  const started = yield* Clock.currentTimeMillis;
  let results = 0;
  const output: PerfOutput = {
    json, failureKind: "error",
    result: (data) => emitJson(command, { type: "result", ...data }).pipe(Effect.tap(() => Effect.sync(() => { results++; }))),
  };
  if (!json) return yield* perf(project, output)(clean);
  const exit = yield* Effect.exit(perf(project, output)(clean));
  if (Exit.isFailure(exit)) {
    const failure = Cause.findErrorOption(exit.cause);
    yield* emitJson(command, {
      type: "failure", kind: output.failureKind, frame: null, client: null,
      message: Option.isSome(failure) ? failure.value.message : Cause.pretty(exit.cause),
    });
  }
  yield* emitJson(command, {
    type: "summary", ok: Exit.isSuccess(exit), counts: { results, failures: Exit.isFailure(exit) ? 1 : 0 },
    elapsedMs: (yield* Clock.currentTimeMillis) - started,
  });
  if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
});
