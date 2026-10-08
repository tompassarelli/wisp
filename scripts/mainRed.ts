// Keeps one open "BRANCH is red" issue per branch in step with that branch's
// latest CI run (wisp:.github/workflows/main-red.yml): a failed run
// opens or updates it with each failing test and the first failing commit
// since the last green run; a green run closes it. The pre-push gate prints
// the open "main is red" issue's tests (wisp:scripts/prePush.ts).
// Usage: bun scripts/mainRed.ts RUN_ID (gh authenticated, repository from GH_REPO or the checkout).
import { Console, Effect, Schema } from "effect";
import { captureProcess } from "./wisp/mapBuild";

class MainRedFailure extends Schema.TaggedError<MainRedFailure>()("MainRedFailure", { command: Schema.String, problem: Schema.String }) {
  override get message(): string {
    return `${this.command}: ${this.problem}`;
  }
}

export const redTitle = (branch: string) => `${branch} is red`;
const TESTS_HEADING = "## Failing tests";

/** Bun's `(fail) NAME [TIME]` and the Lua32 runner's `fail NAME: MESSAGE` lines; a failed step with neither is named instead. */
export function failingTests(log: string): string[] {
  const tests = new Set<string>();
  const steps = new Map<string, boolean>();
  for (const line of log.split("\n")) {
    const [job = "", step = "", stamped = ""] = line.split("\t");
    const text = stamped.replace(/^\S+Z /, "").replace(/\x1b\[[0-9;]*m/g, "");
    const key = `${job}: ${step.replace(/^Run /, "")}`;
    if (!steps.has(key)) steps.set(key, false);
    const bun = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(text);
    const lua = /^fail (.+?): /.exec(text);
    const name = bun?.[1] ?? (lua?.[1] === undefined ? undefined : `Lua32: ${lua[1]}`);
    if (name !== undefined) {
      tests.add(name);
      steps.set(key, true);
    }
  }
  const unnamed = [...steps].filter(([key, named]) => !named && key !== ": ").map(([key]) => `step ${key}`);
  return [...tests, ...unnamed];
}

/** The failing tests an issue body lists. */
export function issueTests(body: string): string[] {
  const section = body.split(TESTS_HEADING)[1]?.split("\n## ")[0] ?? "";
  return section.split("\n").flatMap((line) => (line.startsWith("- ") ? [line.slice(2)] : []));
}

interface Run { readonly databaseId: number; readonly conclusion: string; readonly status: string; readonly headSha: string; readonly url: string }

export function redIssueBody(branch: string, tests: readonly string[], runs: readonly Run[], repository: string): string {
  const [latest] = runs;
  const green = runs.findIndex((run) => run.conclusion === "success");
  const failed = (green === -1 ? runs : runs.slice(0, green)).filter((run) => run.conclusion === "failure");
  const first = failed.at(-1);
  const lastGreen = green === -1 ? undefined : runs[green];
  const short = (sha: string) => sha.slice(0, 10);
  return [
    `CI on \`${branch}\` is failing. Whoever landed the first failing commit owns the fix; nobody lands past this issue as "already failing".`,
    "",
    `- Latest failing run: ${latest?.url ?? "?"} (${short(latest?.headSha ?? "")})`,
    first === undefined ? "" : `- First failing commit: ${first.headSha} (${first.url})`,
    lastGreen === undefined
      ? "- Last green run: none in the recent history"
      : `- Last green commit: ${lastGreen.headSha}; commits that may have broken it: https://github.com/${repository}/compare/${short(lastGreen.headSha)}...${short(first?.headSha ?? latest?.headSha ?? "")}`,
    "",
    TESTS_HEADING,
    "",
    ...tests.slice(0, 200).map((test) => `- ${test}`),
    ...(tests.length > 200 ? [`- and ${tests.length - 200} more`] : []),
    "",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

const gh = (...args: string[]) => captureProcess("gh", args.join(" "), ["gh", ...args]).pipe(
  Effect.mapError((cause) => new MainRedFailure({ command: `gh ${args[0]} ${args[1]}`, problem: String(cause) })),
  Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0 ? Effect.succeed(stdout) : Effect.fail(new MainRedFailure({ command: `gh ${args.join(" ")}`, problem: stderr.trim() }))),
);

const decode = <S extends Schema.Top>(schema: S, command: string) => (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError((cause) => new MainRedFailure({ command, problem: String(cause) })));

const RunSchema = Schema.Struct({ databaseId: Schema.Finite, conclusion: Schema.String, status: Schema.String, headSha: Schema.String, url: Schema.String });
const ThisRun = Schema.Struct({ conclusion: Schema.String, headBranch: Schema.String, workflowName: Schema.String, databaseId: Schema.Finite });
const Issues = Schema.Array(Schema.Struct({ number: Schema.Finite, title: Schema.String }));
const Repository = Schema.Struct({ nameWithOwner: Schema.String });

export const reportRun = (runId: string) => Effect.gen(function*() {
  const run = yield* gh("run", "view", runId, "--json", "conclusion,headBranch,workflowName,databaseId").pipe(Effect.flatMap(decode(ThisRun, "gh run view")));
  if (run.conclusion !== "success" && run.conclusion !== "failure") return yield* Console.log(`run ${runId} ${run.conclusion || "unfinished"}: nothing to report`);
  const history = yield* gh("run", "list", "--workflow", run.workflowName, "--branch", run.headBranch, "--event", "push", "--limit", "100",
    "--json", "databaseId,conclusion,status,headSha,url").pipe(Effect.flatMap(decode(Schema.Array(RunSchema), "gh run list")));
  // Newest first; a run that finished after this one reports instead, so a late event never reopens or closes out of order.
  const completed = history.filter((entry) => entry.conclusion === "success" || entry.conclusion === "failure");
  const index = completed.findIndex((entry) => entry.databaseId === run.databaseId);
  if (index > 0) return yield* Console.log(`run ${runId} is older than run ${completed[0]?.databaseId}: nothing to report`);
  const title = redTitle(run.headBranch);
  const open = (yield* gh("issue", "list", "--state", "open", "--search", `"${title}" in:title`, "--json", "number,title").pipe(Effect.flatMap(decode(Issues, "gh issue list"))))
    .filter((issue) => issue.title === title);
  if (run.conclusion === "success") {
    for (const { number } of open) yield* gh("issue", "close", String(number), "--comment", `Green again at run ${runId}.`);
    return yield* Console.log(open.length === 0 ? `${run.headBranch} is green` : `${run.headBranch} is green: closed #${open.map(({ number }) => number).join(", #")}`);
  }
  const { nameWithOwner } = yield* gh("repo", "view", "--json", "nameWithOwner").pipe(Effect.flatMap(decode(Repository, "gh repo view")));
  const tests = failingTests(yield* gh("run", "view", runId, "--log-failed"));
  const body = redIssueBody(run.headBranch, tests, index === -1 ? completed : completed.slice(index), nameWithOwner);
  const [issue] = open;
  if (issue === undefined) {
    const url = yield* gh("issue", "create", "--title", title, "--body", body);
    return yield* Console.log(`opened ${url.trim()}: ${tests.length} failing`);
  }
  yield* gh("issue", "edit", String(issue.number), "--body", body);
  yield* Console.log(`updated #${issue.number}: ${tests.length} failing`);
});

if (import.meta.main) {
  const runId = process.argv[2];
  if (runId === undefined || !/^\d+$/.test(runId)) {
    console.error("usage: bun scripts/mainRed.ts RUN_ID");
    process.exit(2);
  }
  await Effect.runPromise(reportRun(runId));
}
