// `wisp accept [--only ID...] [--dry-run] [--out DIR]`: runs the game's
// declared native checks in as few fresh matches as their maps allow and
// prints pass, fail or needs-look per check with its evidence folder
// (wisp:docs/accept.md). --only takes ids, or prefixes ending in `*`;
// --dry-run prints the plan without touching a client.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Clock, Console, Effect, type Layer } from "effect";
import {
  AcceptDriver, AcceptFailure, type AcceptReport, type AcceptSuite, type PlannedSession, describePlan, mergeReports, planSessions, privateDirectory, resultLine, runAccept, selectChecks, shardSessions, suiteProblems, summaryLine,
} from "../accept";
import { type Command, type CommandFailure, UsageFailure, flagValues } from "../command";

export interface AcceptOptions {
  readonly suite: AcceptSuite;
  /** Each run saves its evidence in a new private folder here, unless `--out` names one. */
  readonly evidenceRoot: string;
  /** The signed-in clients' driver; built only for a run, never for a dry run. */
  readonly driver: Layer.Layer<AcceptDriver, CommandFailure>;
  /** Client names, the host first, for the plan's text and the declarations' check. */
  readonly clients?: readonly [string, ...string[]];
  /**
   * Runs the checks over several client sets at once (such as offline pool
   * pairs). `select` names the shards a run's arguments ask for; with two or
   * more, the sessions are split over them (shardSessions), `prepare` runs
   * once (a shared map build, say), and `run` plays each shard's checks into
   * its own folder, where it leaves that shard's report.json.
   */
  readonly shards?: AcceptShards;
}

export interface AcceptShards {
  readonly select: (args: readonly string[]) => Effect.Effect<readonly string[], CommandFailure>;
  readonly prepare?: (sessions: readonly PlannedSession[]) => Effect.Effect<void, CommandFailure>;
  readonly run: (shard: string, ids: readonly string[], directory: string) => Effect.Effect<void, CommandFailure>;
  /** Flags the consumer handles in `select`, with their values. */
  readonly flags: readonly string[];
}

const FLAGS = new Set(["--only", "--dry-run", "--out"]);

/** Every value after `--only` up to the next flag, and comma lists. */
const onlyValues = (args: readonly string[]) => {
  const values: string[] = [];
  let taking = false;
  for (const arg of args) {
    if (arg.startsWith("--")) taking = arg === "--only";
    else if (taking) values.push(...arg.split(",").filter((value) => value !== ""));
  }
  return values;
};

/** A folder name for a run started at `millis`: 20261006-213501. */
const runName = (millis: number) => new Date(millis).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export const makeAccept = ({ suite, evidenceRoot, driver, clients = ["host"], shards }: AcceptOptions): Command => (args) => Effect.gen(function*() {
  const known = new Set([...FLAGS, ...(shards?.flags ?? [])]);
  const unknownFlag = args.find((arg) => arg.startsWith("--") && !known.has(arg.split("=")[0]!));
  if (unknownFlag !== undefined) return yield* new UsageFailure({ problem: `unknown option ${unknownFlag}` });
  if (args.includes("--out") && flagValues(args, "out").length === 0) return yield* new UsageFailure({ problem: "--out takes DIR" });
  const problems = suiteProblems(suite, clients);
  if (problems.length > 0) return yield* new AcceptFailure({ operation: "declared checks", problem: problems.join("; ") });
  const { checks, unknown } = selectChecks(suite, onlyValues(args));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `no declared check matches ${unknown.join(", ")}; known: ${suite.checks.map(({ id }) => id).join(", ")}` });
  const sessions = planSessions(checks);
  const selected = shards === undefined ? [] : yield* shards.select(args);
  const split = selected.length > 1 ? shardSessions(sessions, selected.length) : [];
  if (args.includes("--dry-run")) {
    if (split.length > 1) {
      for (const [index, part] of split.entries()) yield* Console.log(`shard ${selected[index]}: ${part.length} sessions, ${part.reduce((sum, { checks: grouped }) => sum + grouped.length, 0)} checks`);
    }
    for (const line of describePlan(suite, sessions, clients[0])) yield* Console.log(line);
    return;
  }
  const directory = flagValues(args, "out")[0] ?? join(evidenceRoot, runName(yield* Clock.currentTimeMillis));
  yield* Console.log(`evidence: ${directory}`);
  const report = shards !== undefined && split.length > 1
    ? yield* runShards(shards, selected, split, checks, directory)
    : yield* runAccept(suite, sessions, directory, (line) => Console.log(line)).pipe(Effect.provide(driver));
  yield* Console.log(summaryLine(report.results));
  const failed = report.results.filter(({ verdict }) => verdict === "fail");
  if (failed.length > 0) return yield* new AcceptFailure({ operation: "accept", problem: `${failed.length} failed: ${failed.map(({ id }) => id).join(", ")}; report ${join(directory, "report.txt")}` });
});

/** Plays each shard's sessions at once and merges their reports into `directory`. */
const runShards = (shards: AcceptShards, selected: readonly string[], split: readonly (readonly PlannedSession[])[], checks: AcceptSuite["checks"], directory: string) => Effect.gen(function*() {
  const started = yield* Clock.currentTimeMillis;
  yield* privateDirectory(directory);
  yield* Console.log(`${split.length} shards: ${split.map((part, index) => `${selected[index]} (${part.length} sessions)`).join(", ")}`);
  if (shards.prepare !== undefined) yield* shards.prepare(split.flat());
  const outcomes = yield* Effect.forEach(split, (part, index) => {
    const shard = selected[index]!;
    const folder = join(directory, `shard-${shard}`);
    return shards.run(shard, part.flatMap(({ checks: grouped }) => grouped.map(({ id }) => id)), folder).pipe(
      Effect.as(""),
      Effect.catch((failure) => Effect.succeed(`shard ${shard}: ${String((failure as { problem?: string }).problem ?? failure)}`)),
      Effect.map((problem) => ({ shard, folder, problem })),
    );
  }, { concurrency: "unbounded" });
  const reports = outcomes.flatMap(({ folder }) => {
    const file = join(folder, "report.json");
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8")) as AcceptReport] : [];
  });
  const shardOf = new Map(split.flatMap((part, index) => part.flatMap(({ checks: grouped }) => grouped.map(({ id }) => [id, outcomes[index]!] as const))));
  const report = mergeReports(directory, checks, reports, started, yield* Clock.currentTimeMillis, (check) => {
    const outcome = shardOf.get(check.id);
    return { id: check.id, closes: check.closes, map: check.map, session: check.session ?? "shared", verdict: "fail", reason: `its shard wrote no result${outcome?.problem ? `: ${outcome.problem}` : ""}`, evidence: outcome?.folder ?? directory, rules: [], readings: {}, files: [] };
  });
  const lines = [...report.results.map(resultLine), summaryLine(report.results), `wall ${((report.finished - started) / 1000).toFixed(0)} s over ${split.length} shards`];
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.write(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await Bun.write(join(directory, "report.txt"), `${lines.join("\n")}\n`);
    },
    catch: (cause) => new AcceptFailure({ operation: "report", problem: String(cause) }),
  });
  for (const line of lines.slice(0, -2)) yield* Console.log(line);
  yield* Console.log(lines.at(-1)!);
  return report;
});
