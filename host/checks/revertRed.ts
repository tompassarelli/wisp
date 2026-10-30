import { appendFileSync } from "node:fs";
import { Console, Effect, Schema } from "effect";
import { captureProcess } from "../process/hostProcess";

class RevertRedFailure extends Schema.TaggedError<RevertRedFailure, { readonly brand: unique symbol }>()("RevertRedFailure", { command: Schema.String, problem: Schema.String }) {
  override get message(): string {
    return `${this.command}: ${this.problem}`;
  }
}

export const REVERT_AFTER_MS = 15 * 60_000;
const SETTLE_MS = 30 * 60_000;
const POLL = "60 seconds";
const CI_WORKFLOW = "ci.yml";

export interface MainRun { readonly id: number; readonly sha: string; readonly conclusion: string; readonly status: string; readonly finishedAt: number }
export interface Landing { readonly sha: string; readonly message: string; readonly parents: number; readonly workflowFiles: readonly string[] }
export type Triage = { readonly kind: "watch" } | { readonly kind: "none"; readonly why: string };
export type Settle = { readonly kind: "wait" | "revert" } | { readonly kind: "none"; readonly why: string };

const finished = (run: { readonly conclusion: string }) => run.conclusion === "success" || run.conclusion === "failure";

export function previousFinished(history: readonly MainRun[], run: MainRun): MainRun | undefined {
  return history.filter((entry) => finished(entry) && entry.id < run.id && entry.sha !== run.sha).toSorted((a, b) => b.id - a.id)[0];
}

export function triage(input: {
  readonly run: MainRun;
  readonly previous: (MainRun & { readonly ancestor: boolean }) | undefined;
  readonly landed: number;
  readonly landing: Landing | undefined;
}): Triage {
  const { run, previous, landed, landing } = input;
  const none = (why: string): Triage => ({ kind: "none", why });
  if (run.conclusion !== "failure") return none(`run ${run.id} ${run.conclusion || "unfinished"}: nothing to revert`);
  if (previous === undefined) return none("no earlier finished run on main to show the parent green");
  if (!previous.ancestor) return none(`the previous run's commit ${previous.sha.slice(0, 10)} isn't an ancestor`);
  if (previous.conclusion !== "success") return none(`the parent was already red (run ${previous.id}): the landing that broke main owns it`);
  if (landed !== 1 || landing === undefined) return none(`${landed} commits landed since the green run: the parent of ${run.sha.slice(0, 10)} was never verified green`);
  if (landing.parents !== 1) return none(`${landing.sha.slice(0, 10)} is a merge commit`);
  if (/^Revert /.test(landing.message) || /^(?:Sheriff-)?Reverts: /m.test(landing.message)) return none(`${landing.sha.slice(0, 10)} is a revert: never revert a revert`);
  if (landing.workflowFiles.length > 0) return none(`${landing.sha.slice(0, 10)} changes ${landing.workflowFiles.join(", ")}, which the workflow token can't push back`);
  return { kind: "watch" };
}

export function settle(input: {
  readonly run: MainRun;
  readonly later: readonly MainRun[];
  readonly now: number;
  readonly onMain: boolean;
  readonly reverted: boolean;
}): Settle {
  const { run, later, now, onMain, reverted } = input;
  const none = (why: string): Settle => ({ kind: "none", why });
  const deadline = run.finishedAt + REVERT_AFTER_MS;
  if (run.conclusion === "success") return none(`run ${run.id} passed on a rerun`);
  if (reverted) return none("main already holds a revert of it");
  if (!onMain) return none("it is no longer on main");
  const green = later.find((entry) => entry.conclusion === "success");
  if (green !== undefined) return none(`main is green again at ${green.sha.slice(0, 10)} (run ${green.id})`);
  if (now < deadline) return { kind: "wait" };
  if (later.some((entry) => entry.status !== "completed")) {
    return now < deadline + SETTLE_MS ? { kind: "wait" } : none("a newer run is still unfinished: a person decides");
  }
  return { kind: "revert" };
}

export function referencedIssues(message: string, repository: string): number[] {
  const [owner = "", name = ""] = repository.split("/");
  const issues = new Set<number>();
  const ours = (prefix: string) => prefix === "" || prefix === name || prefix === `${owner}/${name}`;
  for (const match of message.matchAll(/\b(?:refs|fixes|closes|resolves)\s+((?:[\w.-]+\/)?[\w.-]*)#(\d+)/gi)) if (ours(match[1] ?? "")) issues.add(Number(match[2]));
  for (const match of (message.split("\n")[0] ?? "").matchAll(/\(#(\d+)\)/g)) issues.add(Number(match[1]));
  return [...issues].toSorted((a, b) => a - b);
}

export function revertMessage(input: { readonly landing: Landing; readonly jobs: readonly string[]; readonly runUrl: string; readonly issues: readonly number[] }): string {
  const { landing, jobs, runUrl, issues } = input;
  const subject = landing.message.split("\n")[0] ?? "";
  return [
    `Revert "${subject}"`,
    "",
    `Main's CI stayed red for ${REVERT_AFTER_MS / 60_000} minutes after this landing, whose parent was green. Failing jobs: ${jobs.length === 0 ? "none named" : jobs.join(", ")}`,
    `CI run: ${runUrl}`,
    "",
    ...(issues.length === 0 ? [] : [...issues.map((issue) => `Refs #${issue}`), ""]),
    `Reverts: ${landing.sha}`,
  ].join("\n");
}

export function failureComment(input: { readonly landing: Landing; readonly revert: string; readonly jobs: readonly string[]; readonly runUrl: string }): string {
  const { landing, revert, jobs, runUrl } = input;
  return [
    `Main's CI failed on ${landing.sha} and nothing green landed within ${REVERT_AFTER_MS / 60_000} minutes, so ${revert} reverts it.`,
    "",
    `Failing jobs: ${jobs.length === 0 ? "none named (see the run)" : jobs.join(", ")}`,
    `Run: ${runUrl}`,
    "",
    "Fix the failure in the lane and land the change again.",
  ].join("\n");
}

const run = (command: string, cwd: string | undefined, ...args: string[]) => captureProcess(command, args.join(" "), [command, ...args], cwd === undefined ? {} : { cwd }).pipe(
  Effect.mapError((cause) => new RevertRedFailure({ command: `${command} ${args[0]}`, problem: String(cause) })),
  Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0
    ? Effect.succeed(stdout)
    : Effect.fail(new RevertRedFailure({ command: `${command} ${args.join(" ")}`, problem: stderr.trim() }))),
);
export const gitIn = (cwd: string | undefined) => (...args: string[]) => run("git", cwd, ...args);
const gh = (...args: string[]) => run("gh", undefined, ...args);
const git = gitIn(undefined);

export const pushRevert = (landing: Landing, message: string, git: ReturnType<typeof gitIn>, attempts = 3) => Effect.gen(function*() {
  let last = new RevertRedFailure({ command: "git push", problem: "no attempt" });
  for (let attempt = 0; attempt < attempts; attempt++) {
    yield* git("fetch", "-q", "origin", "main");
    yield* git("checkout", "-q", "-B", "revert-red", "origin/main");
    yield* git("revert", "--no-edit", "--no-commit", landing.sha).pipe(Effect.tapError(() => git("revert", "--abort").pipe(Effect.ignore)));
    yield* git("commit", "-q", "-m", message);
    const pushed = yield* git("push", "-q", "origin", "HEAD:refs/heads/main").pipe(Effect.as(true), Effect.catch((error) => Effect.sync(() => { last = error; return false; })));
    if (pushed) return (yield* git("rev-parse", "HEAD")).trim();
  }
  return yield* last;
});

const decode = <S extends Schema.Top>(schema: S, command: string) => (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError((cause) => new RevertRedFailure({ command, problem: String(cause) })));

const RunRow = Schema.Struct({ databaseId: Schema.Finite, headSha: Schema.String, conclusion: Schema.String, status: Schema.String, updatedAt: Schema.String });
const RunView = Schema.Struct({
  ...RunRow.fields,
  headBranch: Schema.String, workflowName: Schema.String, url: Schema.String,
  jobs: Schema.Array(Schema.Struct({ name: Schema.String, conclusion: Schema.String })),
});
const Repository = Schema.Struct({ nameWithOwner: Schema.String });
const IssueState = Schema.Struct({ state: Schema.String, url: Schema.String });

const mainRun = (row: typeof RunRow.Type): MainRun => ({ id: row.databaseId, sha: row.headSha, conclusion: row.conclusion, status: row.status, finishedAt: Date.parse(row.updatedAt) });

const summary = (line: string) => Effect.sync(() => {
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Revert red main: ${line}\n`);
}).pipe(Effect.andThen(Console.log(`::notice title=Revert red main::${line}`)));

const landingOf = (sha: string, prior: string) => Effect.gen(function*() {
  const [entry = ""] = (yield* git("log", "--first-parent", "-z", "--format=%H%x1f%P%x1f%B", `${prior}..${sha}`)).split("\0").filter((text) => text.trim() !== "");
  const [commit = "", parents = "", message = ""] = entry.split("\x1f");
  const workflowFiles = (yield* git("diff", "--name-only", prior, sha, "--", ".github/workflows")).split("\n").filter(Boolean);
  return { sha: commit.trim(), message: message.trim(), parents: parents.trim().split(" ").filter(Boolean).length, workflowFiles } satisfies Landing;
});

const alreadyReverted = (sha: string) => git("log", "-z", "--format=%B", `${sha}..origin/main`).pipe(
  Effect.map((log) => log.split("\0").some((message) => new RegExp(`^(?:Sheriff-)?Reverts:.*${sha}|^This reverts commit ${sha}`, "m").test(message))),
);

const onMain = (sha: string) => git("merge-base", "--is-ancestor", sha, "origin/main").pipe(Effect.as(true), Effect.orElseSucceed(() => false));

const notify = (issues: readonly number[], body: string) => Effect.forEach(issues, (number) => Effect.gen(function*() {
  yield* gh("issue", "comment", String(number), "--body", body);
  const { state, url } = yield* gh("issue", "view", String(number), "--json", "state,url").pipe(Effect.flatMap(decode(IssueState, "gh issue view")));
  if (state === "CLOSED" && url.includes("/issues/")) yield* gh("issue", "reopen", String(number));
}).pipe(Effect.catch((error) => Console.warn(`couldn't update #${number}: ${error.message}`))));

const associatedPulls = (repository: string, sha: string) =>
  gh("api", `repos/${repository}/commits/${sha}/pulls`, "--jq", "[.[].number]").pipe(
    Effect.flatMap(decode(Schema.Array(Schema.Finite), "gh api pulls")),
    Effect.orElseSucceed(() => [] as readonly number[]),
  );

const viewRun = (runId: string) =>
  gh("run", "view", runId, "--json", "databaseId,headSha,conclusion,status,updatedAt,headBranch,workflowName,url,jobs").pipe(Effect.flatMap(decode(RunView, "gh run view")));

export const revertRed = (runId: string) => Effect.gen(function*() {
  const view = yield* viewRun(runId);
  if (view.headBranch !== "main") return yield* Console.log(`run ${runId} is on ${view.headBranch}: nothing to revert`);
  const listRuns = gh("run", "list", "--workflow", view.workflowName, "--branch", "main", "--limit", "100", "--json", "databaseId,headSha,conclusion,status,updatedAt")
    .pipe(Effect.flatMap(decode(Schema.Array(RunRow), "gh run list")), Effect.map((rows) => rows.map(mainRun)));
  const failing = mainRun(view);
  yield* git("fetch", "-q", "origin", "main");
  const previous = previousFinished(yield* listRuns, failing);
  const ancestor = previous === undefined ? false : yield* git("merge-base", "--is-ancestor", previous.sha, failing.sha).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
  const landed = previous === undefined || !ancestor ? 0 : (yield* git("rev-list", "--first-parent", "--count", `${previous.sha}..${failing.sha}`)).trim();
  const landing = previous !== undefined && Number(landed) === 1 ? yield* landingOf(failing.sha, previous.sha) : undefined;
  const verdict = triage({ run: failing, previous: previous === undefined ? undefined : { ...previous, ancestor }, landed: Number(landed), landing });
  if (verdict.kind === "none" || landing === undefined) {
    return yield* summary(`${failing.sha.slice(0, 10)}: not reverting: ${verdict.kind === "none" ? verdict.why : "no landing"} (${view.url})`);
  }

  const outcome = yield* Effect.gen(function*() {
    while (true) {
      const current = yield* viewRun(runId);
      yield* git("fetch", "-q", "origin", "main");
      const later = (yield* listRuns).filter((entry) => entry.id > failing.id);
      const step = settle({ run: mainRun(current), later, now: Date.now(), onMain: yield* onMain(landing.sha), reverted: yield* alreadyReverted(landing.sha) });
      if (step.kind !== "wait") return step;
      yield* Effect.sleep(POLL);
    }
  });
  if (outcome.kind === "none") return yield* summary(`${failing.sha.slice(0, 10)}: not reverting: ${outcome.why} (${view.url})`);

  const { nameWithOwner } = yield* gh("repo", "view", "--json", "nameWithOwner").pipe(Effect.flatMap(decode(Repository, "gh repo view")));
  const jobs = view.jobs.filter((job) => job.conclusion === "failure").map((job) => job.name);
  const issues = referencedIssues(landing.message, nameWithOwner);
  const message = revertMessage({ landing, jobs, runUrl: view.url, issues });
  const revert = yield* pushRevert(landing, message, git).pipe(
    Effect.catch((error) => summary(`couldn't revert ${failing.sha.slice(0, 10)}: ${error.message}; a person decides (${view.url})`).pipe(Effect.as(undefined))),
  );
  if (revert === undefined) return;
  yield* gh("workflow", "run", CI_WORKFLOW, "--ref", "main").pipe(Effect.catch((error) => Console.warn(`couldn't start main's CI: ${error.message}`)));
  const comment = failureComment({ landing, revert, jobs, runUrl: view.url });
  yield* notify([...new Set([...issues, ...(yield* associatedPulls(nameWithOwner, landing.sha))])], comment);
  yield* summary(`reverted ${failing.sha.slice(0, 10)} as ${revert.slice(0, 10)} after ${REVERT_AFTER_MS / 60_000} minutes red: ${jobs.join(", ")} (${view.url})`);
});

if (import.meta.main) {
  const runId = process.argv[2];
  if (runId === undefined || !/^\d+$/.test(runId)) {
    console.error("usage: bun host/checks/revertRed.ts RUN_ID");
    process.exit(2);
  }
  await Effect.runPromise(revertRed(runId));
}
