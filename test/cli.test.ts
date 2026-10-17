import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Console, Effect } from "effect";
import { expect, test } from "bun:test";
import { cliProgram, runCli } from "../host/cli/cli";
import { flagValues } from "../host/cli/command";
import { makeCi } from "../host/commands/ci";
import { makeMenus } from "../host/commands/menus";
import { TestPlan } from "../host/dev/testSelection";

test("[property seed 824108] command dispatch preserves value boundaries, empty values and repetition", async () => {
  const lines: string[] = [];
  for (const action of ["host", "join"]) {
    const code = await runCli("wisp", { menus: { usage: "ACTION OPTIONS", load: async () => makeMenus() } },
      ["menus", action, "--folder", "00-Wisp", "--map", "Wisp Sample.w3x", "--name", "wisp 1", "--password", "--port", "47123"],
      (line) => lines.push(line));
    expect(code).toBe(2);
  }
  expect(lines.some((line) => line.includes("menus found"))).toBe(false);
  let seed = 824108;
  for (let index = 0; index < 32; index++) {
    seed = Math.imul(seed, 1664525) + 1013904223;
    const value = String(seed >>> 0);
    let values: string[] = [];
    const code = await runCli("wisp", { probe: { usage: "--password VALUE", load: async () => args => Effect.sync(() => { values = flagValues(args, "password"); }) } },
      ["probe", "--password=", "--port", "47123", "--password", value, `--password=${value}=suffix`, "--password", "--port", "47124"], () => {});
    expect(code).toBe(0);
    expect(values).toEqual(["", value, `${value}=suffix`]);
  }
});

test("[boundary] ci pre-merge runs the type check, only the tests the diff since --base reaches and determinism only when the diff reaches the soak, exiting 0 or 1 by their verdicts and naming the failing tests; --plan-only runs none", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-ci-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("package.json", JSON.stringify({ name: "ci-boundary", private: true, scripts: { test: `bun ${join(import.meta.dir, "../host/testing/testRunner.ts")}` } }));
  write("src/a.ts", "export const a = 1;\n");
  write("src/b.ts", "export const b = 1;\n");
  write("notes.md", "notes\n");
  // The soak imports a but not b or the notes: Wisp's own soak project, reached from inside the root through a.
  write("soak/project.ts", `import "../src/a";\nexport { default } from ${JSON.stringify(join(import.meta.dir, "soak/ci-project.ts"))};\n`);
  write("test/a.test.ts", 'import { expect, test } from "bun:test";\nimport { a } from "../src/a";\ntest("a", () => expect(a).toBe(1));\n');
  // b's test fails whenever it runs, and leaves a mark: pre-merge must leave it out until b changes, and --plan-only always.
  write("test/b.test.ts", 'import { appendFileSync } from "node:fs";\nimport { expect, test } from "bun:test";\nimport { b } from "../src/b";\ntest("b", () => { appendFileSync("b-ran", ""); expect(b).toBe(2); });\n');
  const git = (...args: string[]) => expect(Bun.spawnSync(["git", "-c", "user.name=ci", "-c", "user.email=ci@example.invalid", ...args], { cwd: root }).exitCode).toBe(0);
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const ci = makeCi({ root, sources: ["src", "test"], typeCheck: { command: ["true"] }, tests: { files: ["test/**/*.test.ts"] }, soak: { project: join(root, "soak/project.ts"), out: join(root, "out") } });
  const output = async (...flags: string[]) => {
    const lines: string[] = [];
    const code = await Effect.runPromise(cliProgram("ci", { ci: { usage: "", load: async () => ci } }, ["ci", "pre-merge", "--base", "HEAD", "--json", ...flags], () => {}).pipe(
      Effect.provideService(Console.Console, { ...console, log: (...text: unknown[]) => lines.push(text.join(" ")), error: () => {} }),
    ));
    return { code, lines: lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
  };
  const run = async () => {
    const { code, lines } = await output();
    return { code, results: lines.filter((line) => line.type === "result").map(({ stage, verdict, selected, total, failed, reason }) => ({ stage, verdict, selected, total, failed, reason })) };
  };
  write("notes.md", "notes, changed\n");
  const skipped = "no change since HEAD reaches the soak: 1 changed files";
  expect(await run()).toEqual({ code: 0, results: [
    { stage: "type check", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: undefined },
    { stage: "tests", verdict: "passed", selected: 0, total: 2, failed: undefined, reason: undefined },
    { stage: "determinism", verdict: "skipped", selected: undefined, total: undefined, failed: undefined, reason: skipped },
  ] });
  expect((await output("--plan-only")).lines.map(({ determinism }) => determinism)).toEqual([{ runs: false, reason: skipped }]);
  write("src/a.ts", "export const a = 1; // changed\n");
  const reaches = "src/a.ts reaches the soak";
  expect(await run()).toEqual({ code: 0, results: [
    { stage: "type check", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: undefined },
    { stage: "tests", verdict: "passed", selected: 1, total: 2, failed: undefined, reason: undefined },
    { stage: "determinism LUA", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: reaches },
    { stage: "determinism TOWARD_ZERO_LUA", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: reaches },
  ] });
  write("src/b.ts", "export const b = 1; // changed\n");
  const plan = await output("--plan-only");
  expect(plan.code).toBe(0);
  expect(plan.lines.map(({ type, base, selected, total, changed, reasons, determinism }) => ({ type, base, selected, total, changed, reasons, determinism }))).toEqual([{
    type: "plan", base: "HEAD", selected: ["test/a.test.ts", "test/b.test.ts"], total: 2, changed: ["src/a.ts", "src/b.ts"],
    reasons: { "test/a.test.ts": "imports src/a.ts", "test/b.test.ts": "imports src/b.ts" }, determinism: { runs: true, reason: reaches },
  }]);
  expect(existsSync(join(root, "b-ran"))).toBe(false);
  expect(await run()).toEqual({ code: 1, results: [
    { stage: "type check", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: undefined },
    { stage: "tests", verdict: "failed", selected: 2, total: 2, failed: ["test/b.test.ts > b"], reason: undefined },
    { stage: "determinism LUA", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: reaches },
    { stage: "determinism TOWARD_ZERO_LUA", verdict: "passed", selected: undefined, total: undefined, failed: undefined, reason: reaches },
  ] });
  expect(existsSync(join(root, "b-ran"))).toBe(true);
});

test("[property] a direct selection keeps the changed test and the tests that import the changed module, counts the tests that reach it only through another module as deferred, and leaves a file no test declares reading to the landing gate instead of running every test", () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-selection-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("src/core.ts", "export const core = 1;\n");
  write("src/mid.ts", 'import { core } from "./core";\nexport const mid = core + 1;\n');
  write("test/core.test.ts", 'import { core } from "../src/core";\nexport const seen = core;\n');
  write("test/mid.test.ts", 'import { mid } from "../src/mid";\nexport const seen = mid;\n');
  write("test/other.test.ts", "export const seen = 0;\n");
  const plan = new TestPlan(root, { files: ["test/**/*.test.ts"] });
  const select = (path: string, reach: "direct" | "transitive") => {
    const selection = plan.select({ changed: [join(root, path)], created: [], deleted: [] }, reach);
    return { units: selection.units.map((unit) => relative(root, unit.path)), deferred: selection.deferred };
  };
  expect(select("src/core.ts", "direct")).toEqual({ units: ["test/core.test.ts"], deferred: 1 });
  expect(select("src/core.ts", "transitive")).toEqual({ units: ["test/core.test.ts", "test/mid.test.ts"], deferred: 0 });
  expect(select("src/mid.ts", "direct")).toEqual({ units: ["test/mid.test.ts"], deferred: 0 });
  expect(select("test/mid.test.ts", "direct")).toEqual({ units: ["test/mid.test.ts"], deferred: 0 });
  write("notes.tsv", "a\tb\n");
  expect(plan.select({ changed: [join(root, "notes.tsv")], created: [], deleted: [] }, "direct").unread).toEqual([join(root, "notes.tsv")]);
  expect(plan.select({ changed: [join(root, "notes.tsv")], created: [], deleted: [] }, "transitive").full).toBe("no test declares reading notes.tsv");
});
