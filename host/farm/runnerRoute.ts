import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Console, Effect, Schema } from "effect";
import { captureProcess } from "../process/hostProcess";

export interface Routing {
  readonly premerge: string;
  readonly background: string;
  readonly hosted: string;
  readonly capacity: number;
}
export type RunnerClass = "premerge" | "background";

export const FARM_EVENTS: ReadonlySet<string> = new Set(["push", "workflow_dispatch", "schedule"]);

export interface Facts {
  readonly event: string;
  readonly attempt: number;
  readonly override: string;
  readonly want: number;
  readonly busy: number;
}

export interface Choice { readonly runner: string; readonly reason: string }

// Only events that run the owner's own workflow file may reach the self-hosted farm: a fork's pull_request or pull_request_target never does.
export function chooseRunner(routing: Routing, runnerClass: RunnerClass, facts: Facts): Choice {
  const farm = routing[runnerClass];
  const hosted = (reason: string): Choice => ({ runner: routing.hosted, reason });
  const want = Math.min(routing.capacity, Math.max(1, facts.want));
  if (farm === routing.hosted) return hosted(`${runnerClass} is configured for hosted runners`);
  if (!FARM_EVENTS.has(facts.event)) return hosted(`${facts.event} events never use the farm`);
  if (facts.attempt > 1) return hosted(`attempt ${facts.attempt} is a retry`);
  if (facts.override !== "") return { runner: facts.override, reason: `dispatch input names ${facts.override}` };
  const idle = Math.max(0, routing.capacity - facts.busy);
  if (idle < want) return hosted(`${facts.busy} of ${routing.capacity} farm runners are busy or queued, ${idle} idle for ${want} wanted`);
  return { runner: farm, reason: `${idle} of ${routing.capacity} farm runners idle for ${want} wanted` };
}

class RouteFailure extends Schema.TaggedError<RouteFailure, { readonly brand: unique symbol }>()("RouteFailure", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}

const gh = (path: string) => captureProcess("gh", `gh api ${path}`, ["gh", "api", path]).pipe(
  Effect.mapError((cause) => new RouteFailure({ problem: String(cause) })),
  Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0 ? Effect.succeed(stdout) : Effect.fail(new RouteFailure({ problem: `gh api ${path}: ${stderr.trim()}` }))),
);

const RoutingFile = Schema.fromJsonString(Schema.Struct({ premerge: Schema.String, background: Schema.String, hosted: Schema.String, capacity: Schema.Finite }));
const Runs = Schema.fromJsonString(Schema.Struct({ workflow_runs: Schema.Array(Schema.Struct({ id: Schema.Finite })) }));
const Jobs = Schema.fromJsonString(Schema.Struct({ jobs: Schema.Array(Schema.Struct({ status: Schema.String, labels: Schema.Array(Schema.String) })) }));

// The runners API needs an admin token the workflow lacks, so busy runners are the unfinished jobs asking for the farm label.
export const busyFarmJobs = (repo: string, farm: string) => Effect.gen(function*() {
  const ids = new Set<number>();
  for (const status of ["in_progress", "queued"]) {
    const runs = yield* gh(`repos/${repo}/actions/runs?status=${status}&per_page=50`).pipe(Effect.flatMap(Schema.decodeEffect(Runs)));
    for (const { id } of runs.workflow_runs) ids.add(id);
  }
  let busy = 0;
  for (const id of ids) {
    const { jobs } = yield* gh(`repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`).pipe(Effect.flatMap(Schema.decodeEffect(Jobs)));
    busy += jobs.filter((job) => job.status !== "completed" && job.labels.includes(farm)).length;
  }
  return busy;
}).pipe(Effect.mapError((cause) => cause instanceof RouteFailure ? cause : new RouteFailure({ problem: String(cause) })));

const route = (routing: Routing, runnerClass: RunnerClass, repo: string, event: string, attempt: number, override: string, want: number) => Effect.gen(function*() {
  const farm = routing[runnerClass];
  const candidate = farm !== routing.hosted && FARM_EVENTS.has(event) && attempt <= 1 && override === "";
  const busy = candidate ? yield* busyFarmJobs(repo, farm) : 0;
  const choice = chooseRunner(routing, runnerClass, { event, attempt, override, want, busy });
  yield* Console.log(`runner=${choice.runner}\nidle=${candidate ? Math.max(0, routing.capacity - busy) : 0}\nreason=${choice.reason}`);
});

if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: {
    class: { type: "string" }, routing: { type: "string", default: "runner-routing.json" }, override: { type: "string", default: "" }, want: { type: "string", default: "1" },
  } });
  const repo = process.env.GITHUB_REPOSITORY;
  const event = process.env.GITHUB_EVENT_NAME;
  const runnerClass = values.class === "premerge" || values.class === "background" ? values.class : undefined;
  if (repo === undefined || event === undefined || runnerClass === undefined) {
    console.error("usage: GITHUB_REPOSITORY=R GITHUB_EVENT_NAME=E GH_TOKEN=T [GITHUB_RUN_ATTEMPT=N] bun host/farm/runnerRoute.ts --class premerge|background [--routing FILE] [--override LABEL] [--want N]");
    process.exit(2);
  }
  const routing = Schema.decodeSync(RoutingFile)(readFileSync(values.routing, "utf8"));
  await Effect.runPromise(route(routing, runnerClass, repo, event, Number(process.env.GITHUB_RUN_ATTEMPT ?? "1"), values.override, Number(values.want)));
}
