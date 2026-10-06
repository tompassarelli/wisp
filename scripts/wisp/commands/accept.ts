// `wisp accept [--only ID...] [--dry-run] [--out DIR]`: runs the game's
// declared native checks in as few fresh matches as their maps allow and
// prints pass, fail or needs-look per check with its evidence folder
// (wisp:docs/accept.md). --only takes ids, or prefixes ending in `*`;
// --dry-run prints the plan without touching a client.
import { join } from "node:path";
import { Clock, Console, Effect, type Layer } from "effect";
import { AcceptDriver, AcceptFailure, type AcceptSuite, describePlan, planSessions, runAccept, selectChecks, suiteProblems, summaryLine } from "../accept";
import { type Command, type CommandFailure, UsageFailure, flagValues } from "../command";

export interface AcceptOptions {
  readonly suite: AcceptSuite;
  /** Each run saves its evidence in a new private folder here, unless `--out` names one. */
  readonly evidenceRoot: string;
  /** The signed-in clients' driver; built only for a run, never for a dry run. */
  readonly driver: Layer.Layer<AcceptDriver, CommandFailure>;
  /** Client names, the host first, for the plan's text and the declarations' check. */
  readonly clients?: readonly [string, ...string[]];
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

export const makeAccept = ({ suite, evidenceRoot, driver, clients = ["host"] }: AcceptOptions): Command => (args) => Effect.gen(function*() {
  const unknownFlag = args.find((arg) => arg.startsWith("--") && !FLAGS.has(arg.split("=")[0]!));
  if (unknownFlag !== undefined) return yield* new UsageFailure({ problem: `unknown option ${unknownFlag}` });
  if (args.includes("--out") && flagValues(args, "out").length === 0) return yield* new UsageFailure({ problem: "--out takes DIR" });
  const problems = suiteProblems(suite, clients);
  if (problems.length > 0) return yield* new AcceptFailure({ operation: "declared checks", problem: problems.join("; ") });
  const { checks, unknown } = selectChecks(suite, onlyValues(args));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `no declared check matches ${unknown.join(", ")}; known: ${suite.checks.map(({ id }) => id).join(", ")}` });
  const sessions = planSessions(checks);
  if (args.includes("--dry-run")) {
    for (const line of describePlan(suite, sessions, clients[0])) yield* Console.log(line);
    return;
  }
  const directory = flagValues(args, "out")[0] ?? join(evidenceRoot, runName(yield* Clock.currentTimeMillis));
  yield* Console.log(`evidence: ${directory}`);
  const report = yield* runAccept(suite, sessions, directory, (line) => Console.log(line)).pipe(Effect.provide(driver));
  yield* Console.log(summaryLine(report.results));
  const failed = report.results.filter(({ verdict }) => verdict === "fail");
  if (failed.length > 0) return yield* new AcceptFailure({ operation: "accept", problem: `${failed.length} failed: ${failed.map(({ id }) => id).join(", ")}; report ${join(directory, "report.txt")}` });
});
