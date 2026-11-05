import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queued } from "../host/checks/autolandTrain";

const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/autoland.yml"), "utf8")) as {
  jobs: { judge: { steps: { id?: string; run?: string }[] } };
};
const judgeStep = workflow.jobs.judge.steps.find((step) => step.id === "judge")?.run ?? "";

const tip = "f1eb450226bd2e58181d05b21a011a0cd7995c10";
const base = "1111111111111111111111111111111111111111";
const passing = { failures: [], problems: [] };

const judgeLoneTip = (outcome: { candidate: object; baseline: object; codeHealth: string; verdict: string }) => {
  const root = mkdtempSync(join(tmpdir(), "wisp-autoland-judge-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\necho "$*" >> "$GH_LOG"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const runner = join(root, "runner");
  cpSync(join(import.meta.dir, "../host/checks"), join(runner, "host/checks"), { recursive: true });
  for (const [dir, summary] of [["candidate", outcome.candidate], ["baseline", outcome.baseline]] as const) {
    mkdirSync(join(runner, dir));
    writeFileSync(join(runner, dir, "summary.json"), JSON.stringify(summary));
  }
  const log = join(root, "gh.log");
  writeFileSync(log, "");
  const run = Bun.spawnSync(["bash", "-c", judgeStep], {
    cwd: runner,
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: log, GITHUB_STEP_SUMMARY: join(root, "summary"), GITHUB_OUTPUT: join(root, "output"), GH_REPO: "o/r", RUN_URL: "u", WORKFLOW_REF: "main",
      VERDICT: "test", MEMBERS: `claude/lane\t${tip}\t${"2".repeat(40)}`, DEFERRED: "", BASE: base, BASELINE_FROM: base,
      SUITE: "success", CI_RESULT: "success", CODE_HEALTH: outcome.codeHealth, CODE_HEALTH_VERDICT: outcome.verdict, CODE_HEALTH_DETAIL: "",
    },
  });
  const posted = readFileSync(log, "utf8").match(/statuses\/(\w+) -f state=(\w+) -f context=autoland/);
  expect(run.exitCode).toBe(1);
  expect(posted?.[1]).toBe(tip);
  return queued([{ name: "claude/lane", age: 1, ahead: 1, states: { denylist: "success", autoland: posted?.[2] ?? "" } }]);
};

test("[spec wisp autoland-judge] a tip whose code-health job ended without a result stays queued for the next run (wisp#250)", () => {
  expect(judgeLoneTip({ candidate: passing, baseline: passing, codeHealth: "failure", verdict: "" })).toEqual(["claude/lane"]);
});

test("[spec wisp autoland-judge] a tip with a test failing that main's run passes is refused until a new commit", () => {
  const candidate = { failures: ["test/a.test.ts > breaks"], problems: [] };
  expect(judgeLoneTip({ candidate, baseline: passing, codeHealth: "success", verdict: "pass" })).toEqual([]);
});
