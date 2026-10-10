import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schedule, Schema } from "effect";
import { describeCause } from "./command";
import { Summary } from "./farmShards";

export class FarmFailure extends Schema.TaggedError<FarmFailure>()("FarmFailure", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}

const runOnce = (argv: readonly string[], inherit: boolean, cwd: string | undefined) => Effect.acquireUseRelease(
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

export const RATE_LIMITED = /rate limit|HTTP 429|abuse detection/i;

export const run = (argv: readonly string[], inherit = false, cwd?: string) => argv[0] !== "gh" ? runOnce(argv, inherit, cwd) : runOnce(argv, inherit, cwd).pipe(
  Effect.tapError((failure) => RATE_LIMITED.test(failure.message) ? Effect.sync(() => console.error(`GitHub is rate-limiting requests; retrying ${argv.slice(0, 3).join(" ")} with backoff`)) : Effect.void),
  Effect.retry({ while: (failure) => RATE_LIMITED.test(failure.message), schedule: Schedule.min([Schedule.exponential("30 seconds"), Schedule.spaced("5 minutes")]).pipe(Schedule.jittered, Schedule.upTo({ duration: "65 minutes" })) }),
);

export const currentRepo = run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).pipe(
  Effect.tap((repo) => sweepScratch(repo)),
);

export const resolveRef = (given: string | undefined, repo: string) => Effect.gen(function*() {

  const sha = yield* run(["git", "rev-parse", "--verify", `${given ?? "HEAD"}^{commit}`]);
  yield* run(["git", "fetch", "--quiet", "origin", "main"]);
  const onMain = yield* run(["git", "merge-base", "--is-ancestor", sha, "FETCH_HEAD"]).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
  if (onMain) return { ref: sha, scratch: undefined };
  if (sha !== (yield* run(["git", "rev-parse", "HEAD"]))) return yield* new FarmFailure({ problem: `${sha.slice(0, 12)} isn't on main: check it out to run it, so safe-push pushes it` });
  const scratch = `farm/${sha.slice(0, 12)}`;
  console.error(`${sha.slice(0, 12)} isn't on main: pushing it to ${scratch} for the run (deleted afterwards)`);

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

const deleteScratch = (repo: string, scratch: string) =>
  run(["gh", "api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${scratch}`]).pipe(Effect.catch((failure) => Effect.sync(() => console.error(`couldn't delete ${scratch}: ${failure.message}`))));

const Runs = Schema.Array(Schema.Struct({ databaseId: Schema.Finite, displayTitle: Schema.String, url: Schema.String }));
export const RunState = Schema.Struct({
  status: Schema.String,
  conclusion: Schema.String,
  jobs: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String, conclusion: Schema.String })),
});
export type RunState = typeof RunState.Type;

export const decoded = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError((cause) => new FarmFailure({ problem: `unexpected gh output: ${describeCause(cause)}` })));

const ScratchPages = Schema.Array(Schema.Struct({ data: Schema.Struct({ repository: Schema.Struct({ refs: Schema.Struct({
  nodes: Schema.Array(Schema.Struct({ name: Schema.String, target: Schema.Struct({ oid: Schema.String, committedDate: Schema.String }) })),
}) }) }) }));
const ActivePages = Schema.Array(Schema.Struct({ workflow_runs: Schema.Array(Schema.Struct({ head_branch: Schema.NullOr(Schema.String), head_sha: Schema.String, display_title: Schema.String })) }));

export const sweepScratch = (repo: string) => Effect.gen(function*() {
  const [owner, name] = repo.split("/");
  const query = `query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){refs(refPrefix:"refs/heads/farm/",first:100,after:$endCursor){nodes{name target{oid ... on Commit{committedDate}}}pageInfo{hasNextPage endCursor}}}}`;
  const pages = yield* decoded(ScratchPages, yield* run(["gh", "api", "graphql", "--paginate", "--slurp", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`]));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = pages.flatMap((page) => page.data.repository.refs.nodes).filter((ref) => Date.parse(ref.target.committedDate) < cutoff);
  if (stale.length === 0) return;
  const active = [];
  for (const status of ["queued", "in_progress"]) {
    const pages = yield* decoded(ActivePages, yield* run(["gh", "api", `repos/${repo}/actions/runs?status=${status}&per_page=100`, "--paginate", "--slurp"]));
    active.push(...pages.flatMap((page) => page.workflow_runs));
  }
  for (const ref of stale) {
    const branch = `farm/${ref.name}`;
    if (active.some((run) => run.head_branch === branch || run.head_sha === ref.target.oid || run.display_title.split(/\s+/).includes(ref.target.oid) || run.display_title.split(/\s+/).includes(branch))) continue;
    yield* deleteScratch(repo, branch);
  }
});

export const runTag = () => randomBytes(4).toString("hex");

export const dispatch = (repo: string, workflow: string, inputs: Readonly<Record<string, string>> & { readonly tag: string }) => Effect.gen(function*() {
  yield* run(["gh", "workflow", "run", workflow, "-R", repo, "--ref", "main", ...Object.entries(inputs).flatMap(([name, value]) => ["-f", `${name}=${value}`])]);
  for (let tries = 0; tries < 24; tries++) {
    const listed = yield* run(["gh", "run", "list", "-R", repo, "--workflow", workflow, "--event", "workflow_dispatch", "-L", "20", "--json", "databaseId,displayTitle,url"]);
    const found = (yield* decoded(Runs, listed)).find((item) => item.displayTitle.endsWith(` ${inputs.tag}`));
    if (found !== undefined) {
      console.error(`${found.displayTitle}: ${found.url}`);
      return found;
    }
    yield* Effect.sleep("5 seconds");
  }
  return yield* new FarmFailure({ problem: `no ${workflow} run named ${inputs.tag} appeared within two minutes` });
});

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

export const POLL = { first: 10, growth: 1.5, most: 60 } as const;

export const nextPoll = (seconds: number, moved: boolean) => moved ? POLL.first : Math.min(POLL.most, Math.round(seconds * POLL.growth));

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

export const withArtifact = <A, E>(repo: string, id: number, name: string, use: (folder: string) => Effect.Effect<A, E>) => Effect.acquireUseRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wisp-farm-"))),
  (folder) => run(["gh", "run", "download", String(id), "-R", repo, "-n", name, "-D", folder]).pipe(Effect.andThen(use(folder))),
  (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
);

export function summaryLines(summary: Summary): { readonly lines: readonly string[]; readonly ok: boolean } {
  const suite = (name: string, count: Summary["bun"]) => count.shards === 0 ? []
    : [`${name}: ${count.passed} passed, ${count.failed} failed, ${count.skipped} skipped (${count.shards} shards, slowest ${count.slowestShardSeconds.toFixed(0)} s of tests)`];
  return {
    lines: [...suite("bun", summary.bun), ...suite("lua32", summary.lua), ...summary.failures.map((name) => `FAIL ${name}`), ...summary.problems.map((problem) => `PROBLEM ${problem}`)],
    ok: summary.failures.length === 0 && summary.problems.length === 0,
  };
}

export const farmTest = (options: { readonly ref: string | undefined; readonly wait: boolean }) => Effect.scoped(Effect.gen(function*() {
  const repo = yield* currentRepo;
  const started = performance.now();

  const sha = yield* run(["git", "rev-parse", "--verify", `${options.ref ?? "HEAD"}^{commit}`]);
  const joined = yield* activeRun(repo, "farm-test.yml", `Farm test ${sha} `);
  if (joined !== undefined && !options.wait) return;
  const { ref, found } = joined !== undefined ? { ref: sha, found: joined } : yield* Effect.gen(function*() {
    const { ref, scratch } = yield* resolveRef(options.ref, repo);
    const found = yield* dispatch(repo, "farm-test.yml", { ref, tag: runTag() });
    return { ref, found: !options.wait && scratch === undefined ? undefined : found };
  });
  if (found === undefined) return;
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
}));
