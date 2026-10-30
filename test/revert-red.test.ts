import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  type Landing, type MainRun, REVERT_AFTER_MS, failureComment, gitIn, previousFinished, pushRevert, referencedIssues, revertMessage, settle, triage,
} from "../host/checks/revertRed";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 31, 8, 5);
const run = (id: number, sha: string, conclusion: string, minutes: number, status = "completed"): MainRun => ({ id, sha, conclusion, status, finishedAt: T0 + minutes * MINUTE });
const landing = (sha: string, message = "Render compare (Fixes #7)", extra: Partial<Landing> = {}): Landing => ({ sha, message, parents: 1, workflowFiles: [], ...extra });

const green = run(10, "a".repeat(40), "success", -30);
const bad = run(11, "b".repeat(40), "failure", 0);
const history = [bad, green, run(9, "9".repeat(40), "failure", -90)];

test("[invariant] a red main whose parent is green is watched; a red parent, an unverified parent, a revert or a workflow change is not", () => {
  const previous = { ...previousFinished(history, bad)!, ancestor: true };
  expect(previous.id).toBe(10);
  const base = { run: bad, previous, landed: 1, landing: landing(bad.sha) };
  expect(triage(base)).toEqual({ kind: "watch" });

  const parentRed = { ...previousFinished([bad, run(10, "a".repeat(40), "failure", -30)], bad)!, ancestor: true };
  expect(triage({ ...base, previous: parentRed })).toEqual({ kind: "none", why: "the parent was already red (run 10): the landing that broke main owns it" });
  expect(triage({ ...base, landed: 2 }).kind).toBe("none");
  expect(triage({ ...base, previous: { ...previous, ancestor: false } }).kind).toBe("none");
  expect(triage({ ...base, previous: undefined }).kind).toBe("none");
  expect(triage({ ...base, run: { ...bad, conclusion: "success" } }).kind).toBe("none");
  expect(triage({ ...base, landing: landing(bad.sha, 'Revert "Render compare"\n\nReverts: abc') }).kind).toBe("none");
  expect(triage({ ...base, landing: landing(bad.sha, "x", { workflowFiles: [".github/workflows/ci.yml"] }) }).kind).toBe("none");
  expect(triage({ ...base, landing: landing(bad.sha, "x", { parents: 2 }) }).kind).toBe("none");
});

test("[invariant] a red main reverts only once 15 minutes pass with no green main run; a fix inside the window, a revert already on main or a rerun that passed reverts nothing", () => {
  const input = { run: bad, later: [] as MainRun[], onMain: true, reverted: false };
  expect(settle({ ...input, now: T0 + 14 * MINUTE })).toEqual({ kind: "wait" });
  expect(settle({ ...input, now: T0 + REVERT_AFTER_MS })).toEqual({ kind: "revert" });

  const fix = run(12, "c".repeat(40), "success", 6);
  const fixed = settle({ ...input, later: [fix], now: T0 + 20 * MINUTE });
  expect(fixed).toEqual({ kind: "none", why: `main is green again at ${"c".repeat(10)} (run 12)` });
  expect(settle({ ...input, later: [fix], now: T0 + 7 * MINUTE }).kind).toBe("none");

  const stillRed = run(12, "c".repeat(40), "failure", 8);
  expect(settle({ ...input, later: [stillRed], now: T0 + 16 * MINUTE })).toEqual({ kind: "revert" });
  const pending = run(12, "c".repeat(40), "", 14, "in_progress");
  expect(settle({ ...input, later: [pending], now: T0 + 16 * MINUTE })).toEqual({ kind: "wait" });
  expect(settle({ ...input, later: [pending], now: T0 + 50 * MINUTE }).kind).toBe("none");

  expect(settle({ ...input, reverted: true, now: T0 + 20 * MINUTE }).kind).toBe("none");
  expect(settle({ ...input, onMain: false, now: T0 + 20 * MINUTE }).kind).toBe("none");
  expect(settle({ ...input, run: { ...bad, conclusion: "success" }, now: T0 + 20 * MINUTE }).kind).toBe("none");
});

test("[invariant] the revert commit is Revert \"subject\" with a Reverts: trailer of the full sha, and the comment names the failing jobs", () => {
  const sha = "1d1f3b82".padEnd(40, "0");
  const subject = "Compare renders by their frame hash (Fixes #7, Refs tompassarelli/smashcraft#832)";
  const issues = referencedIssues(`${subject}\n\nbody Refs other/repo#9`, "tompassarelli/wisp");
  expect(issues).toEqual([7]);
  const message = revertMessage({ landing: landing(sha, subject), jobs: ["framework", "knip"], runUrl: "https://github.com/x/y/actions/runs/11", issues });
  expect(message.split("\n")[0]).toBe(`Revert "${subject}"`);
  expect(message).toContain("Failing jobs: framework, knip");
  expect(message).toContain("Refs #7");
  expect(message.split("\n").at(-1)).toBe(`Reverts: ${sha}`);
  const comment = failureComment({ landing: landing(sha), revert: "deadbeef", jobs: ["framework", "knip"], runUrl: "https://github.com/x/y/actions/runs/11" });
  expect(comment).toContain(`failed on ${sha}`);
  expect(comment).toContain("Failing jobs: framework, knip");
});

const folder = mkdtempSync(join(tmpdir(), "revert-red-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("[invariant] pushRevert pushes a new revert commit to origin main with the Reverts trailer and rewrites no history", async () => {
  const sh = (cwd: string, ...args: string[]) => {
    const out = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
    return out.stdout.toString().trim();
  };
  const origin = join(folder, "origin.git");
  const work = join(folder, "work");
  const runner = join(folder, "runner");
  sh(folder, "init", "-q", "--bare", "-b", "main", origin);
  sh(folder, "clone", "-q", origin, work);
  writeFileSync(join(work, "a.txt"), "green\n");
  sh(work, "add", "a.txt");
  sh(work, "commit", "-q", "-m", "A green start");
  sh(work, "push", "-q", "origin", "HEAD:main");
  writeFileSync(join(work, "a.txt"), "broken\n");
  sh(work, "commit", "-q", "-am", "Break a.txt (Fixes #7)");
  sh(work, "push", "-q", "origin", "HEAD:main");
  const x = sh(work, "rev-parse", "HEAD");
  const parent = sh(work, "rev-parse", "HEAD~1");
  sh(folder, "clone", "-q", origin, runner);
  sh(runner, "config", "user.name", "t");
  sh(runner, "config", "user.email", "t@t");

  const message = revertMessage({ landing: landing(x, "Break a.txt (Fixes #7)"), jobs: ["framework"], runUrl: "u", issues: [7] });
  const pushed = await Effect.runPromise(pushRevert(landing(x, "Break a.txt (Fixes #7)"), message, gitIn(runner)));

  expect(sh(origin, "rev-parse", "main")).toBe(pushed);
  expect(sh(origin, "rev-parse", `${pushed}~1`)).toBe(x);
  expect(sh(origin, "log", "-1", "--format=%s", "main")).toBe('Revert "Break a.txt (Fixes #7)"');
  expect(sh(origin, "log", "-1", "--format=%(trailers:key=Reverts,valueonly)", "main")).toBe(x);
  expect(sh(origin, "merge-base", "--is-ancestor", parent, x)).toBe("");
  expect(sh(origin, "show", "main:a.txt")).toBe("green");
  expect(readFileSync(join(runner, "a.txt"), "utf8")).toBe("green\n");
});
