




import { existsSync } from "node:fs";
import { join } from "node:path";
import { Clock, Console, Effect, type Layer, Option, Result, Schema } from "effect";
import {
  AcceptDriver, AcceptFailure, type AcceptReport, type AcceptSuite, type PlannedSession, describePlan, mergeReports, planSessions, privateDirectory, resultLine, runAccept, selectChecks, shardSessions, suiteProblems, summaryLine,
} from "../accept";
import { type Command, type CommandFailure, UsageFailure, describeCause, flagValues } from "../command";
import { emitJson } from "../jsonResults";

export interface AcceptOptions {
  readonly suite: AcceptSuite;

  readonly evidenceRoot: string;

  readonly driver: Layer.Layer<AcceptDriver, CommandFailure>;

  readonly clients?: readonly [string, ...string[]];







  readonly shards?: AcceptShards;
}

export interface AcceptShards {
  readonly select: (args: readonly string[]) => Effect.Effect<readonly string[], CommandFailure>;
  readonly prepare?: (sessions: readonly PlannedSession[]) => Effect.Effect<void, CommandFailure>;
  readonly run: (shard: string, ids: readonly string[], directory: string) => Effect.Effect<void, CommandFailure>;

  readonly flags: readonly string[];
}


const ShardReport = Schema.fromJsonString(Schema.Struct({
  directory: Schema.String,
  started: Schema.Finite,
  finished: Schema.Finite,
  results: Schema.Array(Schema.Struct({
    id: Schema.String,
    closes: Schema.String,
    map: Schema.String,
    session: Schema.String,
    verdict: Schema.Literals(["pass", "fail", "needs-look"]),
    reason: Schema.String,
    evidence: Schema.String,
    rules: Schema.Array(Schema.Struct({ rule: Schema.String, holds: Schema.Boolean, observed: Schema.String, orLook: Schema.Boolean })),
    readings: Schema.Record(Schema.String, Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]))),
    files: Schema.Array(Schema.String),
  })),
}));


const readShardReport = (file: string) => Effect.gen(function*() {
  if (!existsSync(file)) return undefined;
  const text = yield* Effect.tryPromise({ try: () => Bun.file(file).text(), catch: (cause) => new AcceptFailure({ operation: "read shard report", problem: `${file}: ${describeCause(cause)}` }) });
  const report: AcceptReport = yield* Schema.decodeEffect(ShardReport)(text).pipe(Effect.mapError((issue) => new AcceptFailure({ operation: "read shard report", problem: `${file}: ${issue.message}` })));
  return report;
});

const FLAGS = new Set(["--only", "--dry-run", "--out", "--json"]);


const onlyValues = (args: readonly string[]) => {
  const values: string[] = [];
  let taking = false;
  for (const arg of args) {
    if (arg.startsWith("--")) taking = arg === "--only";
    else if (taking) values.push(...arg.split(",").filter((value) => value !== ""));
  }
  return values;
};


const runName = (millis: number) => new Date(millis).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export const makeAccept = ({ suite, evidenceRoot, driver, clients = ["host"], shards }: AcceptOptions): Command => (args) => Effect.gen(function*() {
  const json = args.includes("--json");
  const started = performance.now();
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
    if (json) {
      for (const session of sessions) yield* emitJson("accept", { type: "result", ok: true, planned: true, ...session });
      yield* emitJson("accept", { type: "summary", ok: true, counts: { results: sessions.length, checks: checks.length, failures: 0 }, elapsedMs: performance.now() - started });
      return;
    }
    if (split.length > 1) {
      for (const [index, part] of split.entries()) yield* Console.log(`shard ${selected[index]}: ${part.length} sessions, ${part.reduce((sum, { checks: grouped }) => sum + grouped.length, 0)} checks`);
    }
    for (const line of describePlan(suite, sessions, clients[0])) yield* Console.log(line);
    return;
  }
  const directory = flagValues(args, "out")[0] ?? join(evidenceRoot, runName(yield* Clock.currentTimeMillis));
  if (!json) yield* Console.log(`evidence: ${directory}`);
  const report = shards !== undefined && split.length > 1
    ? yield* runShards(shards, selected, split, checks, directory, json)
    : yield* runAccept(suite, sessions, directory, (line) => json ? Effect.void : Console.log(line)).pipe(Effect.provide(driver));
  const failed = report.results.filter(({ verdict }) => verdict === "fail");
  if (json) {
    for (const result of report.results) yield* emitJson("accept", { type: "result", ok: result.verdict !== "fail", ...result, ...(result.verdict === "fail" ? { kind: "check-fail", frame: null, client: null, message: result.reason } : {}) });
    yield* emitJson("accept", { type: "summary", ok: failed.length === 0, counts: { results: report.results.length, failures: failed.length, passed: report.results.filter(({ verdict }) => verdict === "pass").length, needsLook: report.results.filter(({ verdict }) => verdict === "needs-look").length }, elapsedMs: performance.now() - started, evidence: directory });
  } else yield* Console.log(summaryLine(report.results));
  if (failed.length > 0) return yield* new AcceptFailure({ operation: "accept", problem: `${failed.length} failed: ${failed.map(({ id }) => id).join(", ")}; report ${join(directory, "report.txt")}` });
});


const shardProblem = (shard: string, failure: CommandFailure) => `shard ${shard}: ${"problem" in failure && typeof failure.problem === "string" ? failure.problem : failure.message}`;


const runShards = (shards: AcceptShards, selected: readonly string[], split: readonly (readonly PlannedSession[])[], checks: AcceptSuite["checks"], directory: string, json = false) => Effect.gen(function*() {
  const started = yield* Clock.currentTimeMillis;
  yield* privateDirectory(directory);
  if (!json) yield* Console.log(`${split.length} shards: ${split.map((part, index) => `${selected[index]} (${part.length} sessions)`).join(", ")}`);
  if (shards.prepare !== undefined) yield* shards.prepare(split.flat());
  const outcomes = yield* Effect.forEach(split, (part, index) => {
    const shard = selected[index]!;
    const folder = join(directory, `shard-${shard}`);
    return Effect.gen(function*() {
      const failure = yield* shards.run(shard, part.flatMap(({ checks: grouped }) => grouped.map(({ id }) => id)), folder).pipe(Effect.flip, Effect.option);
      const read = yield* readShardReport(join(folder, "report.json")).pipe(Effect.result);
      const report = Result.isSuccess(read) ? read.success : undefined;
      const failures: readonly CommandFailure[] = [...Option.toArray(failure), ...(Result.isFailure(read) ? [read.failure] : [])];
      return { shard, folder, failures, report };
    });
  }, { concurrency: "unbounded" });
  const reports = outcomes.flatMap(({ report }) => (report === undefined ? [] : [report]));
  const shardOf = new Map(split.flatMap((part, index) => part.flatMap(({ checks: grouped }) => grouped.map(({ id }) => [id, outcomes[index]!] as const))));
  const report = mergeReports(directory, checks, reports, started, yield* Clock.currentTimeMillis, (check) => {
    const outcome = shardOf.get(check.id);
    return { id: check.id, closes: check.closes, map: check.map, session: check.session ?? "shared", verdict: "fail", reason: `its shard wrote no result${outcome === undefined || outcome.failures.length === 0 ? "" : `: ${outcome.failures.map((failure) => shardProblem(outcome.shard, failure)).join("; ")}`}`, evidence: outcome?.folder ?? directory, rules: [], readings: {}, files: [] };
  });
  const lines = [...report.results.map(resultLine), summaryLine(report.results), `wall ${((report.finished - started) / 1000).toFixed(0)} s over ${split.length} shards`];
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.write(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await Bun.write(join(directory, "report.txt"), `${lines.join("\n")}\n`);
    },
    catch: (cause) => new AcceptFailure({ operation: "report", problem: String(cause) }),
  });
  if (!json) {
    for (const line of lines.slice(0, -2)) yield* Console.log(line);
    yield* Console.log(lines.at(-1)!);
  }
  return report;
});
