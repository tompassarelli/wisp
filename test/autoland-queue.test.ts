import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { joinOrDispatch } from "../host/checks/autolandQueue";

test("[spec wisp autoland-queue] a pushed branch dispatches a queue run when none is waiting", () => {
  expect(joinOrDispatch([])).toEqual({ action: "dispatch" });
});

test("[spec wisp autoland-queue] a pushed branch joins a queue run that has not yet read its members", () => {
  expect(joinOrDispatch([{ id: 7, rebase: null }])).toEqual({ action: "join", run: 7 });
  expect(joinOrDispatch([{ id: 8, rebase: "queued" }])).toEqual({ action: "join", run: 8 });
  expect(joinOrDispatch([{ id: 1, rebase: "completed" }, { id: 9, rebase: "waiting" }])).toEqual({ action: "join", run: 9 });
});

test("[spec wisp autoland-queue] a pushed branch dispatches a new queue run when every waiting one is past reading its members", () => {
  expect(joinOrDispatch([{ id: 1, rebase: "in_progress" }])).toEqual({ action: "dispatch" });
  expect(joinOrDispatch([{ id: 2, rebase: "completed" }])).toEqual({ action: "dispatch" });
});

const relativeImports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from "(\.{1,2}\/[^"]+)"/g)].map((match) => resolve(dirname(file), `${match[1]}.ts`));

test("[spec wisp autoland-queue] the queue job's sparse checkout holds every module autolandQueue.ts loads", () => {
  const workflow = Bun.YAML.parse(readFileSync(".github/workflows/autoland.yml", "utf8")) as { jobs: { queue: { steps: { with?: { "sparse-checkout"?: string } }[] } } };
  const sparse = workflow.jobs.queue.steps.flatMap((step) => step.with?.["sparse-checkout"]?.split("\n").filter(Boolean) ?? []);
  const seen = new Set<string>();
  const pending = [resolve("host/checks/autolandQueue.ts")];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...relativeImports(file));
  }
  const missing = [...seen].map((file) => relative(process.cwd(), file)).filter((file) => !sparse.some((dir) => file.startsWith(`${dir}/`)));
  expect(missing).toEqual([]);
});
