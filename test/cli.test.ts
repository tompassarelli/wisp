import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Console, Effect } from "effect";
import { expect, test } from "bun:test";
import { cliProgram, runCli } from "../scripts/wisp/cli";
import { flagValues } from "../scripts/wisp/command";
import { makeCi } from "../scripts/wisp/commands/ci";
import { makeMenus } from "../scripts/wisp/commands/menus";

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

test("[boundary] ci pre-merge runs the type check and only the tests the diff since --base reaches, exiting 0 or 1 by their verdicts", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-ci-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("package.json", JSON.stringify({ name: "ci-boundary", private: true, scripts: { test: `bun ${join(import.meta.dir, "../scripts/wisp/testRunner.ts")}` } }));
  write("src/a.ts", "export const a = 1;\n");
  write("src/b.ts", "export const b = 1;\n");
  write("test/a.test.ts", 'import { expect, test } from "bun:test";\nimport { a } from "../src/a";\ntest("a", () => expect(a).toBe(1));\n');
  // b's test fails whenever it runs: pre-merge must leave it out until b changes.
  write("test/b.test.ts", 'import { expect, test } from "bun:test";\nimport { b } from "../src/b";\ntest("b", () => expect(b).toBe(2));\n');
  const git = (...args: string[]) => expect(Bun.spawnSync(["git", "-c", "user.name=ci", "-c", "user.email=ci@example.invalid", ...args], { cwd: root }).exitCode).toBe(0);
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const ci = makeCi({ root, sources: ["src", "test"], typeCheck: { command: ["true"] }, tests: { files: ["test/**/*.test.ts"] } });
  const run = async () => {
    const lines: string[] = [];
    const code = await Effect.runPromise(cliProgram("ci", { ci: { usage: "", load: async () => ci } }, ["ci", "pre-merge", "--base", "HEAD", "--json"], () => {}).pipe(
      Effect.provideService(Console.Console, { ...console, log: (...text: unknown[]) => lines.push(text.join(" ")), error: () => {} }),
    ));
    return { code, results: lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.type === "result").map(({ stage, verdict, selected, total }) => ({ stage, verdict, selected, total })) };
  };
  write("src/a.ts", "export const a = 1; // changed\n");
  expect(await run()).toEqual({ code: 0, results: [
    { stage: "type check", verdict: "passed", selected: undefined, total: undefined },
    { stage: "tests", verdict: "passed", selected: 1, total: 2 },
  ] });
  write("src/b.ts", "export const b = 1; // changed\n");
  expect(await run()).toEqual({ code: 1, results: [
    { stage: "type check", verdict: "passed", selected: undefined, total: undefined },
    { stage: "tests", verdict: "failed", selected: 2, total: 2 },
  ] });
});
