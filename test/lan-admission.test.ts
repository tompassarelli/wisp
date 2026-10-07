import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const capacity = join(import.meta.dir, "fixtures/lan/capacity.ts");
const run = async (pressure: number) => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-admission-"));
  const log = join(directory, "clients.log");
  try {
    const source = `import { Effect } from "effect"; import { lan } from "./scripts/wisp/commands/lan"; await Effect.runPromise(lan(["pool", "--pairs", "3", "--wait", "0", "--seconds", "1", "--desktop", "unused", "--capacity", ${JSON.stringify(capacity)}]));`;
    const child = Bun.spawn([process.execPath, "-e", source], { cwd: root, env: { ...process.env, XDG_STATE_HOME: directory, WISP_ADMISSION_LOG: log, WISP_ADMISSION_PRESSURE: String(pressure) }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const clients = Bun.file(log).size > 0 ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { stdout, stderr, code, clients };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("three requested pairs start only the admitted native clients and report the remaining pairs waiting", async () => {
  const result = await run(0);
  expect(result.code).toBe(0);
  expect(result.clients).toEqual(["wisp-lan:lan0a", "wisp-lan:lan0b"]);
  expect(result.stdout).toContain("pool stays at 1 pair; waiting: 1, 2");
}, 10000);

test("away profile stops new pairs at 20 percent protected CPU pressure", async () => {
  const result = await run(20);
  expect(result.clients).toEqual([]);
  expect(result.stdout).toContain("protected CPU pressure 20%");
  expect(result.stdout).toContain("waiting: 0, 1, 2");
  expect(result.code).not.toBe(0);
});

test("direct pair entry points refuse a missing capacity helper before launch", async () => {
  for (const script of ["pairSession", "pairAgent"]) {
    const child = Bun.spawn([process.execPath, join(root, `scripts/wisp/lan/${script}.ts`)], { stdout: "pipe", stderr: "pipe" });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(code).not.toBe(0);
    expect(stderr).toContain(`${script} requires --capacity`);
  }
});
