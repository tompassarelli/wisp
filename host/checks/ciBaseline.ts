import { Console, Effect, Schema } from "effect";
import { captureProcess } from "../process/hostProcess";

class CiBaselineFailure extends Schema.TaggedError<CiBaselineFailure, { readonly brand: unique symbol }>()("CiBaselineFailure", { command: Schema.String, problem: Schema.String }) {
  override get message(): string {
    return `${this.command}: ${this.problem}`;
  }
}

export const MAIN_RUNS = 3;
const CI_PREFIX = "ci / ";

export interface FailedJob { readonly name: string; readonly url: string; readonly tests: readonly string[] }
export interface Verdict { readonly fresh: readonly FailedJob[]; readonly known: readonly FailedJob[] }

export function failedTestNames(log: string): string[] {
  const names = new Set<string>();
  for (const line of log.split("\n")) {
    const text = line.replace(/^﻿/, "").replace(/^\S+Z /, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\r$/, "");
    const found = /^test (.+) \.\.\. FAILED$/.exec(text)?.[1] ?? /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(text)?.[1];
    if (found !== undefined) names.add(found);
  }
  return [...names].toSorted();
}

/** A failed job is already main's when main failed the same job in its last runs and the candidate fails no test those runs did not (a crash that names no test is main's own when main failed the job too). */
export function judgeJobs(candidate: readonly FailedJob[], main: readonly (readonly FailedJob[])[]): Verdict {
  const failedOnMain = (name: string) => main.flatMap((run) => run.filter((job) => job.name === name));
  const fresh: FailedJob[] = [];
  const known: FailedJob[] = [];
  for (const job of candidate) {
    const seen = failedOnMain(job.name.slice(CI_PREFIX.length));
    const named = new Set(seen.flatMap((entry) => entry.tests));
    (seen.length > 0 && job.tests.every((test) => named.has(test)) ? known : fresh).push(job);
  }
  return { fresh, known };
}

const gh = (...args: string[]) => captureProcess("gh", args.join(" "), ["gh", ...args]).pipe(
  Effect.mapError((cause) => new CiBaselineFailure({ command: `gh ${args[0]} ${args[1]}`, problem: String(cause) })),
  Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0 ? Effect.succeed(stdout) : Effect.fail(new CiBaselineFailure({ command: `gh ${args.join(" ")}`, problem: stderr.trim() }))),
);

const decode = <S extends Schema.Top>(schema: S, command: string) => (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError((cause) => new CiBaselineFailure({ command, problem: String(cause) })));

const Runs = Schema.Array(Schema.Struct({ databaseId: Schema.Finite, conclusion: Schema.String }));
const Jobs = Schema.Struct({ jobs: Schema.Array(Schema.Struct({ id: Schema.Finite, name: Schema.String, conclusion: Schema.NullOr(Schema.String), html_url: Schema.String })) });

const failedJobs = (repository: string, runId: number, keep: (name: string) => boolean) => Effect.gen(function*() {
  const { jobs } = yield* gh("api", `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`).pipe(Effect.flatMap(decode(Jobs, "gh api jobs")));
  return yield* Effect.forEach(jobs.filter((job) => job.conclusion === "failure" && keep(job.name)), (job) =>
    gh("api", `repos/${repository}/actions/jobs/${job.id}/logs`).pipe(
      Effect.map((log) => failedTestNames(log)),
      Effect.orElseSucceed(() => [] as string[]),
      Effect.map((tests): FailedJob => ({ name: job.name, url: job.html_url, tests })),
    ));
});

export const compare = (repository: string, runId: number) => Effect.gen(function*() {
  const candidate = yield* failedJobs(repository, runId, (name) => name.startsWith(CI_PREFIX));
  if (candidate.length === 0) return { fresh: [], known: [] } satisfies Verdict;
  const history = yield* gh("run", "list", "--workflow", "ci.yml", "--branch", "main", "--status", "completed", "--limit", "20", "--json", "databaseId,conclusion").pipe(Effect.flatMap(decode(Runs, "gh run list")));
  const recent = history.filter((run) => run.conclusion === "success" || run.conclusion === "failure").slice(0, MAIN_RUNS);
  const main = yield* Effect.forEach(recent, (run) => failedJobs(repository, run.databaseId, () => true));
  return judgeJobs(candidate, main);
});

if (import.meta.main) {
  const runId = process.argv[2];
  const repository = process.env.GH_REPO;
  if (runId === undefined || !/^\d+$/.test(runId) || repository === undefined) {
    console.error("usage: GH_REPO=OWNER/NAME bun host/checks/ciBaseline.ts RUN_ID");
    process.exit(2);
  }
  await Effect.runPromise(compare(repository, Number(runId)).pipe(Effect.flatMap((verdict) => Console.log(JSON.stringify(verdict)))));
}
