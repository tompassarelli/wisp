export type QueueRun = { readonly id: number; readonly rebase: string | null };

export type QueueChoice = { readonly action: "join"; readonly run: number } | { readonly action: "dispatch" };

const NOT_STARTED = new Set(["requested", "pending", "queued", "waiting"]);

export function joinOrDispatch(runs: readonly QueueRun[]): QueueChoice {
  const open = runs.find((run) => run.rebase === null || NOT_STARTED.has(run.rebase));
  return open ? { action: "join", run: open.id } : { action: "dispatch" };
}

function gh(args: readonly string[]): string {
  const result = Bun.spawnSync(["gh", ...args], { stderr: "inherit" });
  if (!result.success) throw new Error(`gh ${args.join(" ")} exited ${result.exitCode}`);
  return result.stdout.toString();
}

function unfinishedQueueRuns(): QueueRun[] {
  const runs: { databaseId: number; displayTitle: string; status: string }[] = JSON.parse(
    gh(["run", "list", "--workflow", "autoland.yml", "--limit", "100", "--json", "databaseId,displayTitle,status"]),
  );
  return runs
    .filter((run) => run.displayTitle === "Autoland queue" && run.status !== "completed")
    .map((run) => {
      const jobs: { name: string; status: string }[] = JSON.parse(gh(["api", `repos/{owner}/{repo}/actions/runs/${run.databaseId}/jobs`, "--jq", ".jobs"]));
      return { id: run.databaseId, rebase: jobs.find((job) => job.name === "rebase")?.status ?? null };
    });
}

if (import.meta.main) {
  const choice = joinOrDispatch(unfinishedQueueRuns());
  console.log(choice.action === "join" ? `join ${choice.run}` : "dispatch");
}
