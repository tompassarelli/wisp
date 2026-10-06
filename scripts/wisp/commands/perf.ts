// `wisp perf`: plays one of the game's runs with its map's compiled bundle in
// 32-bit Lua and measures every frame (wisp:docs/frame-cost.md#headless);
// `wisp perf compare A B` compares two such runs and fails when B is worse.
import { join } from "node:path";
import { Console, Effect, Schema } from "effect";
import { mapCompiler, report } from "../../compiler";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { DEFAULT_PERF_THRESHOLD, comparePerfRuns, parsePerfRun, predictionLines } from "../perf";
import { step } from "../timings";

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

const compare: Command = (args) => Effect.gen(function*() {
  const [thresholdText = String(DEFAULT_PERF_THRESHOLD)] = flagValues(args, "threshold");
  const paths = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--threshold");
  const threshold = Number(thresholdText);
  const [a, b] = paths;
  if (a === undefined || b === undefined || paths.length !== 2 || !(threshold >= 0)) {
    return yield* new UsageFailure({ problem: "perf compare takes two runs and an optional --threshold share, such as 0.05" });
  }
  const comparison = comparePerfRuns(yield* readRun(a), yield* readRun(b), threshold);
  yield* Console.log(comparison.lines.join("\n"));
  if (comparison.regressions.length > 0) {
    return yield* new PerfFailure({ problem: `B is worse than A by more than ${threshold * 100}%: ${comparison.regressions.join("; ")}` });
  }
  yield* Console.log(`B is no worse than A beyond ${threshold * 100}%`);
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

/** `perf [RUN] [--frames N] [--samples] [--out FILE]` and `perf compare A B [--threshold SHARE]`. */
export const makePerf = (project: PerfProject): Command => (args) => Effect.gen(function*() {
  if (args[0] === "compare") return yield* compare(args.slice(1));
  const [out] = flagValues(args, "out");
  const [framesText = String(DEFAULT_FRAMES)] = flagValues(args, "frames");
  const named = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--out" && args[index - 1] !== "--frames");
  const runs = projectRuns(project);
  const name = named[0] ?? project.defaultRun ?? "journey";
  const frames = Number(framesText);
  if (named.length > 1 || runs[name] === undefined || !Number.isInteger(frames) || frames < 1) {
    return yield* new UsageFailure({ problem: `perf takes one run (${Object.keys(runs).join(", ")}), --frames N, --samples and --out FILE, or compare A B` });
  }
  const { output, summary, measured } = yield* measureRun(project, name, frames, args.includes("--samples"));
  if (out !== undefined) yield* Effect.tryPromise({ try: () => Bun.write(out, output), catch: (cause) => new PerfFailure({ problem: `writing ${out}: ${describeCause(cause)}` }) });
  yield* Console.log(summary);
  yield* Console.log(predictionLines(measured).join("\n"));
  if (measured.problems > 0) return yield* new PerfFailure({ problem: `the run found ${measured.problems} problem(s); its frames are not a measurement` });
});
