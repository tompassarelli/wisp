// `wisp perf`: plays the game's journey with its map's compiled bundle in
// 32-bit Lua and measures every frame (wisp:docs/frame-cost.md#headless);
// `wisp perf compare A B` compares two such runs and fails when B is worse.
import { join } from "node:path";
import { Console, Effect, Schema } from "effect";
import { mapCompiler, report } from "../../compiler";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { DEFAULT_PERF_THRESHOLD, comparePerfRuns, parsePerfRun } from "../perf";
import { step } from "../timings";

/** A tsconfig and the Lua bundle it writes. */
export interface LuaBuild {
  readonly config: string;
  readonly bundle: string;
}

export interface PerfProject {
  /** The map whose frames are measured, as the development build compiles it. */
  readonly map: LuaBuild;
  /** The Lua program that plays the journey: it calls runLuaPerf with the map's bundle and declarations, its first two arguments. */
  readonly program: LuaBuild;
  /** warcraft.d.ts; the package's by default. */
  readonly declarations?: string;
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

/** `perf [--out FILE]` and `perf compare A B [--threshold SHARE]`. */
export const makePerf = (project: PerfProject): Command => (args) => Effect.gen(function*() {
  if (args[0] === "compare") return yield* compare(args.slice(1));
  const [out] = flagValues(args, "out");
  if (args.length !== (out === undefined ? 0 : 2)) return yield* new UsageFailure({ problem: "perf takes --out FILE, or compare A B" });
  yield* compile(project.map).pipe(step("compile map"));
  yield* compile(project.program).pipe(step("compile perf program"));
  const declarations = project.declarations ?? join(import.meta.dir, "../../../src/natives/warcraft.d.ts");
  const lua = process.env.LUA ?? "lua";
  const run = yield* Effect.try({
    try: () => Bun.spawnSync([lua, project.program.bundle, project.map.bundle, declarations], { stdout: "pipe", stderr: "pipe" }),
    catch: (cause) => new PerfFailure({ problem: `running ${lua}: ${describeCause(cause)}` }),
  }).pipe(step("journey in 32-bit Lua"));
  const output = run.stdout.toString();
  if (run.exitCode !== 0) return yield* new PerfFailure({ problem: `${lua} exited ${run.exitCode}: ${run.stderr.toString()}${output}` });
  const measured = yield* Effect.try({ try: () => parsePerfRun(output), catch: (cause) => new PerfFailure({ problem: describeCause(cause) }) });
  if (out !== undefined) yield* Effect.tryPromise({ try: () => Bun.write(out, output), catch: (cause) => new PerfFailure({ problem: `writing ${out}: ${describeCause(cause)}` }) });
  yield* Console.log(output.trimEnd());
  if (measured.problems > 0) return yield* new PerfFailure({ problem: `the journey found ${measured.problems} problem(s); its frames are not a measurement` });
});
