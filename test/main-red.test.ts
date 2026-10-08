import { expect, test } from "bun:test";
import { failingTests, redIssueBody } from "../scripts/mainRed";
import { redNotice } from "../scripts/prePush";

test("[spec AGENTS.md] a failed run's log names each failing test once, and a failed step without one by its step", () => {
  // Lines as `gh run view --log-failed` printed them for run 37725394675 on 8 Oct 2026.
  const step = "framework\tRun CC=gcc STORMLIB_PREFIX=/usr bun run test\t2026-10-08T04:00:54.4835028Z ";
  const log = [
    `${step}(pass) perf compare --json reports success and budget failures; text stays readable [15.00ms]`,
    `${step}(fail) perf --json plays the compiled map, keeps samples in --out, and ends with a summary [1930.05ms]`,
    `${step}(fail) listed entries are packaged and extracted in one archive opening, byte for byte, keeping clip and texture facts [66.00ms]`,
    `${step}(fail) perf --json plays the compiled map, keeps samples in --out, and ends with a summary [1930.05ms]`,
    "framework\tRun bun run check\t2026-10-08T04:00:20.0000000Z error TS2322: Type 'string' is not assignable to type 'number'.",
  ].join("\n");
  expect(failingTests(log)).toEqual([
    "perf --json plays the compiled map, keeps samples in --out, and ends with a summary",
    "listed entries are packaged and extracted in one archive opening, byte for byte, keeping clip and texture facts",
    "step framework: bun run check",
  ]);
});

test("[spec AGENTS.md] the red-main notice is one line naming the issue's failing tests", () => {
  const run = (id: number, conclusion: string, headSha: string) => ({ databaseId: id, conclusion, status: "completed", headSha, url: `run/${id}` });
  const body = redIssueBody("main", ["frame meter > overlay", "map-pack > listed entries"], [run(3, "failure", "c".repeat(40)), run(2, "failure", "b".repeat(40)), run(1, "success", "a".repeat(40))], "o/r");
  expect(body).toContain(`First failing commit: ${"b".repeat(40)}`);
  const notice = redNotice({ number: 7, body, url: "issue/7" });
  expect(notice).not.toContain("\n");
  for (const name of ["frame meter > overlay", "map-pack > listed entries"]) expect(notice).toContain(name);
});
