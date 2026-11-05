import { Effect, Schema } from "effect";
import { captureProcess } from "../process/hostProcess";

export type QueueRun = { readonly id: number; readonly rebase: string | null };

export type QueueChoice = { readonly action: "join"; readonly run: number } | { readonly action: "dispatch" };

const NOT_STARTED = new Set(["requested", "pending", "queued", "waiting"]);

export function joinOrDispatch(runs: readonly QueueRun[]): QueueChoice {
  const open = runs.find((run) => run.rebase === null || NOT_STARTED.has(run.rebase));
  return open ? { action: "join", run: open.id } : { action: "dispatch" };
}

class QueueFailure extends Schema.TaggedError<QueueFailure, { readonly brand: unique symbol }>()("QueueFailure", { command: Schema.String, problem: Schema.String }) {
  override get message(): string {
    return `${this.command}: ${this.problem}`;
  }
}

const gh = (...args: string[]) => captureProcess("gh", args.join(" "), ["gh", ...args]).pipe(
  Effect.mapError((cause) => new QueueFailure({ command: `gh ${args[0]} ${args[1]}`, problem: String(cause) })),
  Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0 ? Effect.succeed(stdout) : Effect.fail(new QueueFailure({ command: `gh ${args.join(" ")}`, problem: stderr.trim() }))),
);

const Runs = Schema.Array(Schema.Struct({ databaseId: Schema.Finite, displayTitle: Schema.String, status: Schema.String }));
const Jobs = Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String }));

const decode = <S extends Schema.Top>(schema: S, command: string) => (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError((cause) => new QueueFailure({ command, problem: String(cause) })));

const unfinishedQueueRuns = Effect.gen(function*() {
  const runs = yield* gh("run", "list", "--workflow", "autoland.yml", "--limit", "100", "--json", "databaseId,displayTitle,status").pipe(Effect.flatMap(decode(Runs, "gh run list")));
  return yield* Effect.forEach(runs.filter((run) => run.displayTitle === "Autoland queue" && run.status !== "completed"), (run) =>
    gh("api", `repos/{owner}/{repo}/actions/runs/${run.databaseId}/jobs`, "--jq", ".jobs").pipe(
      Effect.flatMap(decode(Jobs, "gh api jobs")),
      Effect.map((jobs): QueueRun => ({ id: run.databaseId, rebase: jobs.find((job) => job.name === "rebase")?.status ?? null })),
    ));
});

if (import.meta.main) {
  const choice = await Effect.runPromise(unfinishedQueueRuns.pipe(Effect.map(joinOrDispatch)));
  console.log(choice.action === "join" ? `join ${choice.run}` : "dispatch");
}
