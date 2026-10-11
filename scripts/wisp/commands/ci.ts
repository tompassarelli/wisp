// One entry point for every check a project runs: local, farm, Autoland's pre-merge step, post-merge and
// nightly (docs/ci-command.md). Each tier is a list of stages; each stage runs an existing runner.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type Command, UsageFailure, describeCause, flagValues, wholeFlag } from "../command";
import { emitJson } from "../jsonResults";
import { lua32 } from "../lua32";
import { type SoakMatch, describeMatch, loadSoakProject, planSoak, readSoakReply } from "../soak";
import { INCONCLUSIVE_EXIT } from "../testRunner";
import { type Changes, type Selection, TestPlan } from "../testSelection";
import { type DevProject, followsSave, isProjectFile } from "./dev";
import { DEFAULT_SOAK_MINUTES, MAX_SOAK_MATCHES, MAX_SOAK_MINUTES, type SoakCommandOptions, makeSoak } from "./soak";

export interface CiProject extends Pick<DevProject, "root" | "sources" | "tests"> {
  readonly typeCheck: Pick<DevProject["typeCheck"], "command">;

  /** The game's soak (`makeSoak`'s options); without one, no tier plays matches. */
  readonly soak?: SoakCommandOptions;
}

export class CiFailure extends Schema.TaggedError<CiFailure>()("CiFailure", {
  problem: Schema.String,
  exitCode: Schema.Int,
}) {
  override get message(): string {
    return this.problem;
  }
}

/** Pre-merge's determinism stage: this many of the soak's matches from seed 1, each capped at this many frames. */
export const DETERMINISM_MATCHES = 8;
export const DETERMINISM_FRAMES = 600;

const TEST_COST_PRELOAD = join(import.meta.dir, "../testCostPreload.ts");
const SOAK_WORKER = join(import.meta.dir, "../soakWorker.ts");
/** farmTest's name prefix (wisp:scripts/wisp/farmTest.ts, which imports bun:test and can't load here). */
const FARM_TEST_PREFIX = "farm: ";
const FARM_TEST_TIMEOUT_MS = 120_000;
const MAX_SEED = 2147483646;

type Verdict = "passed" | "failed" | "inconclusive";

interface Stage {
  readonly name: string;
  readonly verdict: Verdict;
  readonly seconds: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

const verdictOf = (exitCode: number): Verdict => exitCode === 0 ? "passed" : exitCode === INCONCLUSIVE_EXIT ? "inconclusive" : "failed";

const LUA_MODES = [
  { name: "LUA", variant: "stock" },
  { name: "TOWARD_ZERO_LUA", variant: "toward-zero" },
] as const;

const SoakRecord = Schema.fromJsonString(Schema.Struct({
  type: Schema.String,
  ok: Schema.optionalKey(Schema.Boolean),
  kind: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  repro: Schema.optionalKey(Schema.String),
  match: Schema.optionalKey(Schema.Struct({ index: Schema.Int, seed: Schema.Int })),
}));
const decodeSoakRecord = Schema.decodeUnknownEffect(SoakRecord);

const ciFailure = (problem: string) => new CiFailure({ problem, exitCode: 1 });

export const makeCi = (project: CiProject): Command => (allArgs) => Effect.gen(function*() {
  const json = allArgs.includes("--json");
  const [tier, ...args] = allArgs.filter((arg) => arg !== "--json");
  const root = resolve(project.root);
  const started = performance.now();
  const stages: Stage[] = [];
  const say = (line: string) => (json ? Console.error(line) : Console.log(line));

  const record = (stage: Stage) => Effect.gen(function*() {
    stages.push(stage);
    if (json) yield* emitJson("ci", { type: "result", ok: stage.verdict === "passed", stage: stage.name, verdict: stage.verdict, seconds: stage.seconds, ...stage.detail });
    else yield* Console.log(`${stage.name}, ${stage.verdict}, ${stage.seconds.toFixed(1)}`);
  });

  const timed = <E, R>(name: string, run: Effect.Effect<{ readonly verdict: Verdict; readonly detail?: Readonly<Record<string, unknown>> }, E, R>) => Effect.gen(function*() {
    const from = performance.now();
    type Outcome = { readonly verdict: Verdict; readonly detail?: Readonly<Record<string, unknown>> };
    const outcome: Outcome = yield* run.pipe(Effect.catch((failure) => say(`${name}: ${describeCause(failure)}`).pipe(Effect.as<Outcome>({ verdict: "failed" }))));
    yield* record({ name, verdict: outcome.verdict, seconds: (performance.now() - from) / 1000, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) });
  });

  // A stage's own output goes to stderr under --json, so stdout holds only result lines.
  const exitCodeOf = (command: readonly string[], env: Readonly<Record<string, string>> = {}) => Effect.scoped(Effect.gen(function*() {
    const [file = "", ...rest] = command;
    const handle = yield* ChildProcess.make(file, rest, { cwd: root, env, extendEnv: true, stdin: "ignore", stdout: json ? "pipe" : "inherit", stderr: "inherit" });
    if (json) yield* Stream.runForEach(handle.stdout, (chunk) => Effect.sync(() => process.stderr.write(chunk)));
    return Number(yield* handle.exitCode);
  }));

  const text = (command: string, commandArgs: readonly string[]) => ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make(command, commandArgs, { cwd: root })));

  const typeCheck = timed("type check", exitCodeOf(project.typeCheck.command).pipe(Effect.map((code) => ({ verdict: code === 0 ? "passed" as const : "failed" as const }))));

  const plan = () => new TestPlan(root, project.tests);

  // The diff since --base as one save: every path the dev loop follows counts as changed. A fresh scan already
  // knows created files and has dropped deleted ones, so neither forces the whole suite as a new save does.
  const affected = (base: string) => Effect.gen(function*() {
    const top = (yield* text("git", ["rev-parse", "--show-toplevel"])).trim();
    const diff = yield* text("git", ["diff", "--name-only", "--no-renames", base, "--", "."]);
    const untracked = yield* text("git", ["ls-files", "--others", "--exclude-standard", "--full-name", "--", "."]);
    const paths = [...new Set([...diff.split("\n"), ...untracked.split("\n")].filter((line) => line !== "").map((line) => resolve(top, line)))]
      .filter((path) => followsSave(root, project.sources, path));
    const tests = plan();
    const projectFiles = paths.filter((path) => isProjectFile(root, path));
    const selection: Selection = projectFiles.length > 0
      ? tests.everything(`${projectFiles.map((path) => relative(root, path)).join(", ")} changed`)
      : tests.select({ changed: paths, created: [], deleted: [] } satisfies Changes);
    return { selection, total: tests.all().length, changed: paths.length };
  });

  const testFiles = (selection: Selection) => {
    const files = selection.units.filter((unit) => unit.kind === "file").map((unit) => unit.path);
    const runners = selection.units.some((unit) => unit.kind === "registry") ? (project.tests.registryRunners ?? []).map((path) => resolve(root, path)) : [];
    return [...new Set([...files, ...runners])].sort();
  };

  const runTests = (files: readonly string[] | undefined) => {
    const paths = (files ?? []).map((path) => `./${relative(root, path)}`);
    const env = files === undefined ? project.tests.env : project.tests.envForFiles?.(files) ?? project.tests.env;
    return exitCodeOf([process.execPath, "run", "test", ...paths], { ...env }).pipe(Effect.map((code) => ({ verdict: verdictOf(code) })));
  };

  const preMergeTests = (base: string) => timed("tests", Effect.gen(function*() {
    const { selection, total, changed } = yield* affected(base);
    const files = testFiles(selection);
    const scope = selection.full === undefined ? `${files.length} of ${total} test files affected by ${changed} changed files` : `all ${files.length} of ${total} test files: ${selection.full}`;
    yield* say(`tests: ${scope} since ${base}`);
    const detail = { selected: files.length, total };
    if (files.length === 0) return { verdict: "passed" as const, detail };
    return { ...(yield* runTests(files)), detail };
  }));

  const farmTests = timed("farm tests", Effect.gen(function*() {
    const files = plan().all().filter((unit) => unit.kind === "file" && readFileSync(unit.path, "utf8").includes("farmTest(")).map((unit) => `./${relative(root, unit.path)}`);
    yield* say(`farm tests: ${files.length} files`);
    if (files.length === 0) return { verdict: "passed" as const, detail: { files: 0 } };
    const code = yield* exitCodeOf([process.execPath, "test", "--timeout", String(FARM_TEST_TIMEOUT_MS), "--preload", TEST_COST_PRELOAD, "-t", FARM_TEST_PREFIX, ...files], { ...project.tests.env });
    return { verdict: verdictOf(code), detail: { files: files.length } };
  }));

  const soakProject = (soak: SoakCommandOptions) => Effect.tryPromise({ try: () => loadSoakProject(soak.project), catch: (cause) => ciFailure(`loading the soak: ${describeCause(cause)}`) });

  // Pre-merge's seconds-long determinism stage: the soak's fixed seeds with capped frames, once with each Lua32 as
  // LUA, in soak worker processes. Each must end with no finding but its cap, and the two must agree call for call.
  const determinism = (soak: SoakCommandOptions) => Effect.gen(function*() {
    const soaked = yield* soakProject(soak);
    const matches = planSoak(soaked.roster, DETERMINISM_MATCHES, 1, DETERMINISM_FRAMES);
    const stock = yield* lua32("stock");
    const towardZero = yield* lua32("toward-zero");
    const input = matches.map((match) => `${JSON.stringify(match)}\n`).join("");
    const play = (mode: (typeof LUA_MODES)[number]) => Effect.gen(function*() {
      const from = performance.now();
      for (const match of matches) yield* say(`determinism ${mode.name}: seed ${match.seed} (${describeMatch(match)}, ${match.frames} frames)`);
      const env = { LUA: mode.variant === "stock" ? stock : towardZero, TOWARD_ZERO_LUA: towardZero };
      const output = yield* ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make(process.execPath, [SOAK_WORKER, soak.project], {
        cwd: root, env, extendEnv: true, stdin: { stream: Stream.make(new TextEncoder().encode(input)) }, stderr: "inherit",
      })));
      const replies = yield* Effect.forEach(output.split("\n").filter((line) => line !== ""), (line) => Effect.try({ try: () => readSoakReply(line), catch: (cause) => ciFailure(`a soak worker's reply: ${describeCause(cause)}`) }));
      const problems: string[] = [];
      for (const match of matches) {
        const reply = replies.find((each) => each.match.index === match.index);
        if (reply === undefined) problems.push(`seed ${match.seed}: no reply`);
        for (const finding of reply?.findings ?? []) if (finding.kind !== "unfinished") problems.push(`seed ${match.seed}: ${finding.kind} after frame ${finding.frame}: ${finding.text.split("\n")[0]}`);
      }
      return { mode, replies, problems, seconds: (performance.now() - from) / 1000 };
    });
    const [first, second] = yield* Effect.all(LUA_MODES.map(play), { concurrency: "unbounded" });
    if (first === undefined || second === undefined) return;
    const disagreements = matches.flatMap((match) => {
      const one = first.replies.find((reply) => reply.match.index === match.index)?.checksums.join(" ");
      const other = second.replies.find((reply) => reply.match.index === match.index)?.checksums.join(" ");
      return one === other ? [] : [`seed ${match.seed}: native call checksums differ between LUA and TOWARD_ZERO_LUA`];
    });
    for (const run of [first, second]) {
      const problems = [...run.problems, ...disagreements];
      for (const problem of problems) yield* say(`determinism ${run.mode.name}: ${problem}`);
      yield* record({ name: `determinism ${run.mode.name}`, verdict: problems.length === 0 ? "passed" : "failed", seconds: run.seconds, detail: { seeds: matches.map((match) => match.seed), frames: DETERMINISM_FRAMES } });
    }
  }).pipe(Effect.catch((failure) => Effect.gen(function*() {
    yield* say(`determinism: ${describeCause(failure)}`);
    yield* record({ name: "determinism", verdict: "failed", seconds: 0 });
  })));

  // `seeds` and `nightly`: the soak command itself, read through its --json records. Each failing match's repro gets
  // its replay command and an issue body beside it.
  const soakSeeds = (soak: SoakCommandOptions, stage: string, matches: number, firstSeed: number, minutes: number, nightly: boolean) => timed(stage, Effect.gen(function*() {
    const soaked = yield* soakProject(soak);
    const deadline = performance.now() + minutes * 60_000;
    const failed = new Map<string, { readonly seed?: number; readonly repro?: string; readonly findings: string[] }>();
    const seeds: number[] = [];
    let played = 0;
    // Nightly plays batches of new random seeds until its minutes are up; seeds plays one batch.
    for (let seed = firstSeed; ; seed = randomSeed()) {
      const left = Math.max(1, Math.ceil((deadline - performance.now()) / 60_000));
      seeds.push(seed);
      yield* say(`${stage}: ${matches} matches from seed ${seed}, at most ${left} min`);
      if (!nightly) for (const match of planSoak(soaked.roster, matches, seed, soaked.frames)) yield* say(`seed ${match.seed} starts: ${describeMatch(match)}`);
      const lines: string[] = [];
      const capture = { ...console, log: (...parts: unknown[]) => lines.push(parts.join(" ")) };
      yield* makeSoak(soak)(["--matches", String(matches), "--seed", String(seed), "--minutes", String(left), "--json"]).pipe(
        Effect.provideService(Console.Console, capture),
        Effect.ignore,
      );
      const records = yield* Effect.forEach(lines, (line) => decodeSoakRecord(line).pipe(Effect.mapError((issue) => ciFailure(`a soak record: ${issue.message}`))));
      const results = records.filter((each) => each.type === "result");
      played += results.length;
      if (nightly) for (const result of results) if (result.match !== undefined) yield* say(`seed ${result.match.seed} (match ${result.match.index} from seed ${seed})`);
      // The soak reports reaching its time limit as a failure; for nightly that limit is the plan.
      const limited = (each: (typeof records)[number]) => nightly && each.match === undefined && each.message?.startsWith("stopped at the ") === true;
      for (const failure of records.filter((each) => each.type === "failure" && !limited(each))) {
        const key = failure.match === undefined ? `run from seed ${seed}` : `match ${failure.match.index} from seed ${seed}`;
        const entry = failed.get(key) ?? { ...(failure.match === undefined ? {} : { seed: failure.match.seed }), ...(failure.repro === undefined ? {} : { repro: failure.repro }), findings: [] };
        entry.findings.push(`${failure.kind ?? "failure"}: ${failure.message ?? ""}`);
        failed.set(key, entry);
      }
      if (!nightly || performance.now() >= deadline || results.length < matches) break;
    }
    const commit = (yield* text("git", ["rev-parse", "HEAD"]).pipe(Effect.orElseSucceed(() => "unknown"))).trim();
    const cli = process.argv[1] === undefined ? "CLI" : relative(process.cwd(), process.argv[1]);
    const repros: string[] = [];
    for (const [key, entry] of failed) {
      yield* say(`${stage}: ${entry.seed === undefined ? key : `seed ${entry.seed} (${key})`} failed:\n${entry.findings.map((finding) => `  ${finding.split("\n")[0]}`).join("\n")}`);
      if (entry.repro === undefined || !existsSync(entry.repro)) continue;
      const replay = `bun ${cli} repro ${entry.repro}`;
      const issue = entry.repro.replace(/(?:\.json)?$/, ".issue.md");
      yield* Effect.try({
        try: () => writeFileSync(issue, [
          `# ${stage}: seed ${entry.seed ?? "unknown"} fails`, "",
          `- Seed: ${entry.seed ?? "unknown"}`,
          `- Commit: ${commit}`,
          `- Failing stage: ${stage}`,
          `- Replay: \`${replay}\``, "",
          "## Findings", "",
          ...entry.findings.map((finding) => `- ${finding.split("\n")[0]}`), "",
        ].join("\n")),
        catch: (cause) => ciFailure(`writing ${issue}: ${describeCause(cause)}`),
      });
      repros.push(entry.repro);
      yield* say(`  replay: ${replay}\n  issue: ${issue}`);
    }
    return { verdict: failed.size === 0 && played > 0 ? "passed" as const : "failed" as const, detail: { seeds, matches: played, failures: failed.size, repros } };
  }));

  const needSoak = (name: string) => project.soak === undefined ? Effect.fail(new UsageFailure({ problem: `ci ${name} plays the soak, and this project declares none` })) : Effect.succeed(project.soak);
  const randomSeed = () => 1 + Math.floor(Math.random() * MAX_SEED);
  const known = (allowed: readonly string[]) => {
    const unknown = args.find((arg, index) => arg.startsWith("--") ? !allowed.includes(arg.slice(2).split("=")[0] ?? "") : !allowed.includes((args[index - 1] ?? "").slice(2)));
    return unknown === undefined ? Effect.void : Effect.fail(new UsageFailure({ problem: `ci ${tier} doesn't take ${unknown}` }));
  };
  const flag = <A>(value: A | UsageFailure) => value instanceof UsageFailure ? Effect.fail(value) : Effect.succeed(value);

  switch (tier) {
    case "pre-merge": {
      yield* known(["base"]);
      const [base] = flagValues(args, "base");
      if (base === undefined) return yield* new UsageFailure({ problem: "ci pre-merge takes --base SHA" });
      yield* typeCheck;
      yield* preMergeTests(base);
      if (project.soak !== undefined) yield* determinism(project.soak);
      break;
    }
    case "post-merge":
      yield* known([]);
      yield* typeCheck;
      yield* timed("tests", runTests(undefined));
      yield* farmTests;
      break;
    case "nightly": {
      yield* known(["minutes"]);
      const minutes = yield* flag(wholeFlag(args, "minutes", { fallback: DEFAULT_SOAK_MINUTES, min: 1, max: MAX_SOAK_MINUTES }));
      yield* soakSeeds(yield* needSoak("nightly"), "nightly", MAX_SOAK_MATCHES, randomSeed(), minutes, true);
      break;
    }
    case "seeds": {
      yield* known(["n", "seed"]);
      const count = yield* flag(wholeFlag(args, "n", { min: 1, max: MAX_SOAK_MATCHES }));
      if (count === undefined) return yield* new UsageFailure({ problem: "ci seeds takes --n N" });
      const seed = yield* flag(wholeFlag(args, "seed", { fallback: randomSeed(), min: 1, max: MAX_SEED }));
      yield* soakSeeds(yield* needSoak("seeds"), "seeds", count, seed, DEFAULT_SOAK_MINUTES, false);
      break;
    }
    default:
      return yield* new UsageFailure({ problem: "ci takes pre-merge --base SHA | post-merge | nightly [--minutes M] | seeds --n N [--seed S]" });
  }

  const count = (verdict: Verdict) => stages.filter((stage) => stage.verdict === verdict).length;
  if (json) yield* emitJson("ci", { type: "summary", ok: count("passed") === stages.length, tier, counts: { passed: count("passed"), failed: count("failed"), inconclusive: count("inconclusive") }, elapsedMs: performance.now() - started });
  if (count("failed") > 0) return yield* ciFailure(`ci ${tier}: ${count("failed")} of ${stages.length} stages failed`);
  if (count("inconclusive") > 0) return yield* new CiFailure({ problem: `ci ${tier}: ${count("inconclusive")} of ${stages.length} stages inconclusive`, exitCode: INCONCLUSIVE_EXIT });
}).pipe(Effect.provide(BunServices.layer));
