// The farm: a project's headless work on GitHub's free hosted runners instead
// of this machine (wisp:docs/farm.md). A command dispatches one of the
// checkout's workflow_dispatch workflows for a commit, finds the run by a tag
// in its name, waits for it and reads its artifacts. Without --ref the commit
// is the checkout's HEAD: one main doesn't hold yet is pushed with safe-push to
// a scratch branch farm/<commit>, which CI ignores and the command deletes
// after the run (so such a run always waits).
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { describeCause } from "./command";
import { Summary } from "./farmShards";

export class FarmFailure extends Schema.TaggedError<FarmFailure>()("FarmFailure", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}

/** Runs a program to completion: its trimmed stdout, or a failure naming its stderr; interruption kills and reaps it. */
export const run = (argv: readonly string[], inherit = false, cwd?: string) => Effect.acquireUseRelease(
  Effect.try({
    try: () => Bun.spawn([...argv], { ...(cwd === undefined ? {} : { cwd }), stdin: "ignore", stdout: inherit ? "inherit" : "pipe", stderr: inherit ? "inherit" : "pipe" }),
    catch: (cause) => new FarmFailure({ problem: `couldn't start ${argv[0]}: ${describeCause(cause)}` }),
  }),
  (child) => Effect.tryPromise({
    try: async () => {
      const [out, err, code] = await Promise.all([
        child.stdout instanceof ReadableStream ? new Response(child.stdout).text() : "",
        child.stderr instanceof ReadableStream ? new Response(child.stderr).text() : "",
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${argv.slice(0, 3).join(" ")} exited ${code}${err.trim() === "" ? "" : `: ${err.trim()}`}`);
      return out.trim();
    },
    catch: (cause) => new FarmFailure({ problem: describeCause(cause) }),
  }),
  (child) => Effect.promise(async () => {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }),
);

/** The checkout's GitHub repository, OWNER/NAME. */
export const currentRepo = run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);

/**
 * The commit to run, and the scratch branch it was pushed to when main doesn't
 * hold it. The branch belongs to the caller's scope: closing it, after the run
 * or on any failure or interrupt from its creation on, deletes the branch.
 */
export const resolveRef = (given: string | undefined, repo: string) => Effect.gen(function*() {
  // actions/checkout needs a full commit id; a branch or short id resolves here.
  const sha = yield* run(["git", "rev-parse", "--verify", `${given ?? "HEAD"}^{commit}`]);
  yield* run(["git", "fetch", "--quiet", "origin", "main"]);
  const onMain = yield* run(["git", "merge-base", "--is-ancestor", sha, "FETCH_HEAD"]).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
  if (onMain) return { ref: sha, scratch: undefined };
  if (sha !== (yield* run(["git", "rev-parse", "HEAD"]))) return yield* new FarmFailure({ problem: `${sha.slice(0, 12)} isn't on main: check it out to run it, so safe-push pushes it` });
  const scratch = `farm/${sha.slice(0, 12)}`;
  console.error(`${sha.slice(0, 12)} isn't on main: pushing it to ${scratch} for the run (deleted afterwards)`);
  // The scratch branch starts at a commit origin already holds, so safe-push
  // scans only the lane's own commits; from the root, which holds .gitleaksignore.
  const base = yield* run(["git", "merge-base", sha, "FETCH_HEAD"]);
  yield* run(["gh", "api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${scratch}`]).pipe(Effect.ignore);
  yield* Effect.acquireRelease(
    run(["gh", "api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/heads/${scratch}`, "-f", `sha=${base}`]),
    () => deleteScratch(repo, scratch),
  );
  yield* run(["git", "fetch", "--quiet", "origin", `+refs/heads/${scratch}:refs/remotes/origin/${scratch}`]);
  yield* run(["safe-push", "--to", scratch], true, yield* run(["git", "rev-parse", "--show-toplevel"]));
  return { ref: sha, scratch };
});

/** Deletes a scratch branch, reporting rather than failing when it can't. */
const deleteScratch = (repo: string, scratch: string) =>
  run(["gh", "api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${scratch}`]).pipe(Effect.catch((failure) => Effect.sync(() => console.error(`couldn't delete ${scratch}: ${failure.message}`))));

const Runs = Schema.Array(Schema.Struct({ databaseId: Schema.Number, displayTitle: Schema.String, url: Schema.String }));
export const RunState = Schema.Struct({
  status: Schema.String,
  conclusion: Schema.String,
  jobs: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String, conclusion: Schema.String })),
});
export type RunState = typeof RunState.Type;

/** gh's JSON output decoded by `schema`. */
export const decoded = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, text: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError((cause) => new FarmFailure({ problem: `unexpected gh output: ${describeCause(cause)}` })));

/** A fresh tag that names a dispatched run, so the command finds its own. */
export const runTag = () => randomBytes(4).toString("hex");

/** Starts `workflow` on main with `inputs` (which hold `tag`) and finds the run, by the tag that ends its name. */
export const dispatch = (repo: string, workflow: string, inputs: Readonly<Record<string, string>> & { readonly tag: string }) => Effect.gen(function*() {
  yield* run(["gh", "workflow", "run", workflow, "-R", repo, "--ref", "main", ...Object.entries(inputs).flatMap(([name, value]) => ["-f", `${name}=${value}`])]);
  for (let tries = 0; tries < 30; tries++) {
    const listed = yield* run(["gh", "run", "list", "-R", repo, "--workflow", workflow, "--event", "workflow_dispatch", "-L", "20", "--json", "databaseId,displayTitle,url"]);
    const found = (yield* decoded(Runs, listed)).find((item) => item.displayTitle.endsWith(` ${inputs.tag}`));
    if (found !== undefined) {
      console.error(`${found.displayTitle}: ${found.url}`);
      return found;
    }
    yield* Effect.sleep("2 seconds");
  }
  return yield* new FarmFailure({ problem: `no ${workflow} run named ${inputs.tag} appeared within a minute` });
});

/** A queued or running run of `workflow` whose name starts with `prefix`, announced, so a second caller for the same commit joins it instead of starting another. */
export const activeRun = (repo: string, workflow: string, prefix: string) => Effect.gen(function*() {
  for (const status of ["in_progress", "queued"]) {
    const listed = yield* run(["gh", "run", "list", "-R", repo, "--workflow", workflow, "--status", status, "-L", "50", "--json", "databaseId,displayTitle,url"]);
    const found = (yield* decoded(Runs, listed)).find((item) => item.displayTitle.startsWith(prefix));
    if (found !== undefined) {
      console.error(`joining the run already testing this commit: ${found.displayTitle}: ${found.url}`);
      return found;
    }
  }
  return undefined;
});

/** Seconds between `waitFor`'s polls: the first, the growth while nothing moves, and the cap. */
export const POLL = { first: 10, growth: 1.5, most: 60 } as const;

/** The wait before the next poll: back to the first after a change, otherwise grown up to the cap. */
export const nextPoll = (seconds: number, moved: boolean) => moved ? POLL.first : Math.min(POLL.most, Math.round(seconds * POLL.growth));

/**
 * Polls the run until it completes, printing a line when its jobs move. Polls
 * back off from POLL.first to POLL.most seconds while nothing changes, so many
 * waiting workers cost little CPU and API.
 */
export const waitFor = (repo: string, id: number) => Effect.gen(function*() {
  let last = "";
  let seconds: number = POLL.first;
  for (;;) {
    const state = yield* decoded(RunState, yield* run(["gh", "run", "view", String(id), "-R", repo, "--json", "status,conclusion,jobs"]));
    const done = state.jobs.filter((job) => job.status === "completed").length;
    const running = state.jobs.filter((job) => job.status === "in_progress").length;
    const line = `${state.status}: ${done} jobs done, ${running} running, ${state.jobs.length - done - running} waiting`;
    if (line !== last) console.error(line);
    seconds = nextPoll(seconds, line !== last);
    last = line;
    if (state.status === "completed") return state;
    yield* Effect.sleep(`${seconds} seconds`);
  }
});

/** Downloads one artifact of a run into a temporary folder, hands the folder to `use`, then removes it. */
export const withArtifact = <A, E>(repo: string, id: number, name: string, use: (folder: string) => Effect.Effect<A, E>) => Effect.acquireUseRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wisp-farm-"))),
  (folder) => run(["gh", "run", "download", String(id), "-R", repo, "-n", name, "-D", folder]).pipe(Effect.andThen(use(folder))),
  (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
);

/** The summary lines `farm test` prints, and whether the suites passed. */
export function summaryLines(summary: Summary): { readonly lines: readonly string[]; readonly ok: boolean } {
  const suite = (name: string, count: Summary["bun"]) => count.shards === 0 ? []
    : [`${name}: ${count.passed} passed, ${count.failed} failed, ${count.skipped} skipped (${count.shards} shards, slowest ${count.slowestShardSeconds.toFixed(0)} s of tests)`];
  return {
    lines: [...suite("bun", summary.bun), ...suite("lua32", summary.lua), ...summary.failures.map((name) => `FAIL ${name}`), ...summary.problems.map((problem) => `PROBLEM ${problem}`)],
    ok: summary.failures.length === 0 && summary.problems.length === 0,
  };
}

/**
 * `farm test [--ref REF] [--wait]`: the project's full Bun and 32-bit Lua
 * suites on the runners, through its .github/workflows/farm-test.yml, sharded
 * by measured time; prints pass and fail counts and each failing test.
 */
export const farmTest = (options: { readonly ref: string | undefined; readonly wait: boolean }) => Effect.scoped(Effect.gen(function*() {
  const repo = yield* currentRepo;
  const { ref, scratch } = yield* resolveRef(options.ref, repo);
  const started = performance.now();
  yield* Effect.gen(function*() {
    const found = (yield* activeRun(repo, "farm-test.yml", `Farm test ${ref} `)) ?? (yield* dispatch(repo, "farm-test.yml", { ref, tag: runTag() }));
    if (!options.wait && scratch === undefined) return;
    const state = yield* waitFor(repo, found.databaseId);
    console.error(`${((performance.now() - started) / 60000).toFixed(1)} min from dispatch to the result`);
    const summary = yield* withArtifact(repo, found.databaseId, "farm-test-summary", (folder) => Effect.try({
      try: () => readFileSync(join(folder, "summary.json"), "utf8"),
      catch: (cause) => new FarmFailure({ problem: describeCause(cause) }),
    }).pipe(Effect.flatMap((text) => decoded(Summary, text)))).pipe(Effect.mapError((failure) =>
      new FarmFailure({ problem: `the run ended ${state.conclusion} without a summary (${failure.message}); gh run view ${found.databaseId} -R ${repo} --log-failed` })));
    const { lines, ok } = summaryLines(summary);
    for (const line of lines) console.log(line);
    if (!ok) return yield* new FarmFailure({ problem: `${ref.slice(0, 12)} failed on the farm: ${found.url}` });
  });
}));
