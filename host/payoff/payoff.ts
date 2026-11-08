import { join } from "node:path";
import { Clock, Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { stateHome } from "../os/xdg";
import { discover, read, type Run } from "./evidence";
import { type Report, summarize, suppress, weekOf } from "./report";

export interface PayoffOptions {
  /** The Wisp checkout whose evidence/, builds/ and main history are read. */
  readonly repo: string;
  /** More evidence folders a game retains, read beside Wisp's own. */
  readonly evidence: readonly string[];
  /** Unix seconds; runs before it are left out of the weekly rows. */
  readonly since: number;
}

const describe = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

const commits = (repo: string, report: Report) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("git", ["-C", repo, "log", "main", "--format=%ct"], { stderr: "ignore" }))).pipe(
    Effect.map((output) => {
      const totals = new Map<string, number>();
      for (const line of output.split("\n")) {
        const at = Number(line);
        if (line !== "" && Number.isSafeInteger(at)) totals.set(weekOf(at), (totals.get(weekOf(at)) ?? 0) + 1);
      }
      for (const row of report.weeks) row.wisp_commits = totals.get(row.week) ?? 0;
    }),
    Effect.catch(() => Effect.sync(() => { report.warnings.push(`Wisp main commit history unavailable: ${repo}`); })),
  );

/** How often native runs agree with Wisp's verdicts, what they cost in client minutes and which kinds could retire to Wisp only. */
export const payoff = (options: PayoffOptions): Effect.Effect<Report, never, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> => Effect.gen(function*() {
  const roots = [...options.evidence, join(stateHome(), "wisp"), join(options.repo, "evidence"), join(options.repo, "builds")];
  const warnings: string[] = [];
  const files = new Set<string>();
  for (const root of roots) for (const file of yield* discover(root, warnings)) files.add(file);
  const sortedFiles = [...files].sort();
  const runs: Run[] = [];
  for (const path of sortedFiles) {
    const found = yield* Effect.result(read(path));
    if (found._tag === "Success") runs.push(...found.success);
    else warnings.push(`${path}: ${describe(found.failure)}`);
  }
  const now = Math.trunc((yield* Clock.currentTimeMillis) / 1000);
  const report = summarize(runs, options.since, now);
  if (warnings.length > 0) {
    suppress(report);
    warnings.push("Incomplete evidence scan: retirement recommendations suppressed");
  }
  report.files = sortedFiles;
  report.warnings.push(...warnings);
  yield* commits(options.repo, report);
  return report;
});
