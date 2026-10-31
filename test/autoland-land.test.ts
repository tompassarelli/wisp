import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/autoland.yml"), "utf8")) as {
  jobs: { land: { steps: { id?: string; run?: string }[] } };
};
const landStep = workflow.jobs.land.steps.find((step) => step.id === "land")?.run ?? "";

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.toString().trim();
};
const commit = (cwd: string, path: string, text: string, subject: string) => {
  mkdirSync(join(cwd, path, ".."), { recursive: true });
  writeFileSync(join(cwd, path), text);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", subject);
  return git(cwd, "rev-parse", "HEAD");
};

const train = (move: (dev: string, base: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), "wisp-autoland-land-"));
  const origin = join(root, "origin.git");
  const dev = join(root, "dev");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, dev);
  const base = commit(dev, "base.txt", "base", "base");
  git(dev, "push", "-q", "origin", "HEAD:refs/heads/main");
  const members: string[] = [];
  let below = base;
  for (const lane of ["a", "b", "c"]) {
    git(dev, "checkout", "-q", "-B", `claude/${lane}`, base);
    const tip = commit(dev, `${lane}/file.ts`, lane, `lane ${lane}`);
    git(dev, "push", "-q", "origin", `claude/${lane}`);
    git(dev, "checkout", "-q", "-B", "stack", below);
    git(dev, "cherry-pick", tip);
    below = git(dev, "rev-parse", "HEAD");
    members.push(`claude/${lane}\t${tip}\t${below}`);
  }
  git(dev, "push", "-q", "origin", "stack:refs/heads/farm/autoland-1");
  move(dev, base);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\necho "gh $*" >> "$GH_LOG"\n[[ "$1 $2" != "api repos/"* ]] || echo '{"statuses":[{"context":"denylist","state":"success"}]}'\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const runner = join(root, "runner");
  git(root, "clone", "-q", origin, runner);
  cpSync(join(import.meta.dir, "../host/checks"), join(runner, "host/checks"), { recursive: true });
  symlinkSync(join(import.meta.dir, "../node_modules"), join(runner, "node_modules"));
  mkdirSync(join(root, "temp"));
  const files = { log: join(root, "gh.log"), summary: join(root, "summary"), output: join(root, "output") };
  writeFileSync(files.log, "");
  const run = Bun.spawnSync(["bash", "-c", landStep], {
    cwd: runner,
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      GH_LOG: files.log, GITHUB_STEP_SUMMARY: files.summary, GITHUB_OUTPUT: files.output, RUNNER_TEMP: join(root, "temp"),
      SHA: below, MEMBERS: members.join("\n"), DEFERRED: "", BASE: base, SCRATCH: "farm/autoland-1", GH_REPO: "o/r", WORKFLOW_REF: "main", RUN_URL: "u",
    },
  });
  return {
    exitCode: run.exitCode,
    main: git(root, "--git-dir", origin, "log", "--format=%s", "main").split("\n"),
    branches: git(root, "--git-dir", origin, "for-each-ref", "--format=%(refname:short)", "refs/heads/claude"),
    dispatches: readFileSync(files.log, "utf8").split("\n").filter((line) => line.includes("workflow run")),
  };
};

test("[scenario] a passing train lands whole past a main that moved only on paths none of its lanes touch", () => {
  const landed = train((dev, base) => {
    git(dev, "checkout", "-q", "-B", "move", base);
    commit(dev, "docs/notes.md", "notes", "main moves on docs");
    git(dev, "push", "-q", "origin", "move:main");
  });
  expect(landed.exitCode).toBe(0);
  expect(landed.main).toEqual(["lane c", "lane b", "lane a", "main moves on docs", "base"]);
  expect(landed.branches).toBe("");
  expect(landed.dispatches).toEqual([]);
});

test("[scenario] when one lane's tip moves, the lanes before it land and it and the lanes after it are tested again", () => {
  const landed = train((dev) => {
    git(dev, "checkout", "-q", "claude/b");
    commit(dev, "b/file.ts", "b again", "lane b again");
    git(dev, "push", "-q", "origin", "claude/b");
  });
  expect(landed.exitCode).toBe(0);
  expect(landed.main).toEqual(["lane a", "base"]);
  expect(landed.branches).toBe("claude/b\nclaude/c");
  expect(landed.dispatches).toEqual(["gh workflow run autoland.yml --ref main -f branch=claude/b claude/c -f split=yes"]);
});

test("[scenario] a main that moved on one lane's paths lands only the lanes stacked before it", () => {
  const landed = train((dev, base) => {
    git(dev, "checkout", "-q", "-B", "move", base);
    commit(dev, "b/file.ts", "main's b", "main moves on b");
    git(dev, "push", "-q", "origin", "move:main");
  });
  expect(landed.main).toEqual(["lane a", "main moves on b", "base"]);
  expect(landed.branches).toBe("claude/b\nclaude/c");
});
