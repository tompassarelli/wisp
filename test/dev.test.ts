




import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RESULT_PREFIX } from "../scripts/wisp/devResult";
import type { RegistryResult } from "../scripts/wisp/registryRun";
import { type TestUnit, TestPlan, packTests } from "../scripts/wisp/testSelection";

const root = mkdtempSync(join(tmpdir(), "wisp-dev-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const at = (path: string) => join(root, path);

write("src/c.ts", "export const c = 1;\n");
write("src/types.ts", "export interface Shape { readonly size: number }\n");
write("src/b.ts", 'import { c } from "./c";\nimport type { Shape } from "./types";\nexport const b = (shape: Shape) => c + shape.size;\n');
write("src/a.ts", 'export { b } from "./b";\n');
write("src/lazy.ts", 'export const lazy = () => import("./c");\n');
write("src/alone.ts", "export const alone = 2;\n");
write("src/c.tests.ts", 'import { c } from "./c";\nexport const registered = c;\n');
write("test/a.test.ts", 'import { b } from "../src/a";\nexport const used = b;\n');
write("test/lazy.test.ts", 'import { lazy } from "../src/lazy";\nexport const used = lazy;\n');
write("test/fixtures.test.ts", 'import { readFileSync } from "node:fs";\nexport const read = () => readFileSync("test/fixtures/data.json");\n');
write("test/fixtures/data.json", "{}\n");
write("test/undeclared.test.ts", 'import { readFileSync } from "node:fs";\nexport const read = () => readFileSync("notes.txt");\n');
write("test/computed.test.ts", "export const load = (name: string) => import(`../src/${name}`);\n");
write("test/preload.ts", "export {};\n");

const plan = new TestPlan(root, {
  files: ["test/**/*.test.ts"],
  registry: "src/**/*.tests.ts",
  preload: ["test/preload.ts"],
  reads: { "test/fixtures.test.ts": ["test/fixtures/**"] },
});
const names = (units: readonly TestUnit[]) => units.map((unit) => unit.path.slice(root.length + 1)).sort();
const always = ["test/computed.test.ts", "test/undeclared.test.ts"];
const changed = (...paths: string[]) => plan.select({ changed: paths, created: [], deleted: [] });

test("[invariant] a test that reads files without declaring them, or imports a computed path, runs on every save", () => {
  expect(names([...plan.alwaysRun().keys()].map((path) => ({ path, kind: "file" })))).toEqual(always);
});

test("[invariant] a saved module selects every test that loads it, through re-exports and literal dynamic imports", () => {
  const selection = changed(at("src/c.ts"));
  expect(selection.full).toBeUndefined();
  expect(names(selection.units)).toEqual(["src/c.tests.ts", "test/a.test.ts", "test/lazy.test.ts", ...always].sort());
});

test("[invariant] a declared read selects its reader; a file no test loads or declares reading runs everything", () => {
  expect(names(changed(at("test/fixtures/data.json")).units)).toEqual(["test/fixtures.test.ts", ...always].sort());
  const unknown = changed(at("notes.txt"));
  expect(unknown.full).toBe("no test declares reading notes.txt");
  expect(unknown.units.length).toBe(plan.all().length);
});

test("[invariant] a new file, a deleted one or a change to the preload runs everything", () => {
  write("src/new.ts", "export const fresh = 3;\n");
  expect(plan.select({ changed: [], created: [at("src/new.ts")], deleted: [] }).full).toBe("src/new.ts is new");
  expect(plan.select({ changed: [], created: [], deleted: [at("src/alone.ts")] }).full).toBe("src/alone.ts was deleted");
  expect(changed(at("test/preload.ts")).full).toBe("every test preloads test/preload.ts");
});

test("[invariant] a save that changes a module's imports changes what it selects from then on", () => {
  write("src/a.ts", "export const b = 4;\n");
  expect(names(changed(at("src/a.ts")).units)).toEqual(["test/a.test.ts", ...always].sort());
  expect(names(changed(at("src/c.ts")).units)).toEqual(["src/c.tests.ts", "test/lazy.test.ts", ...always].sort());
  write("src/a.ts", 'export { b } from "./b";\n');
  changed(at("src/a.ts"));
});

test("[invariant] registry modules share processes only with each other, and isolated files only with their group", () => {
  const unit = (path: string, kind: TestUnit["kind"] = "file"): TestUnit => ({ path, kind });
  const units = [unit("r1", "registry"), unit("r2", "registry"), unit("r3", "registry"), unit("g1"), unit("g2"), unit("s1"), unit("s2"), unit("s3")];
  const work: Record<string, number> = { r1: 300, r2: 300, r3: 300, g1: 500, g2: 400, s1: 100, s2: 100, s3: 100 };
  const group = (path: string) => (path.startsWith("g") ? "isolated 0" : "shared");
  const processes = packTests(units, (tested) => work[tested.path] ?? 0, group, 4);
  for (const process of processes) {
    const kinds = new Set(process.units.map((tested) => (tested.kind === "registry" ? "registry" : group(tested.path))));
    expect(kinds.size).toBe(1);
  }
  expect(processes.flatMap((process) => process.units.map((tested) => tested.path)).sort()).toEqual(units.map((tested) => tested.path).sort());
});

test("[invariant] the registry process runs each module's tests and reports every failure with the module", async () => {
  write("registry/passing.tests.ts", 'import { test } from "WISP/src/runtime/testing";\ntest("adds", () => {});\ntest("subtracts", () => {});\n'.replace("WISP", join(import.meta.dir, "..")));
  write("registry/failing.tests.ts", 'import { assertEquals, test } from "WISP/src/runtime/testing";\ntest("compares", () => assertEquals(1, 2, "sum"));\n'.replace("WISP", join(import.meta.dir, "..")));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/wisp/registryRun.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(`${JSON.stringify({ preload: [], modules: [at("registry/passing.tests.ts"), at("registry/failing.tests.ts")] })}\n`);
  await child.stdin.end();
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  const results = stdout.split("\n").filter((line) => line.startsWith(RESULT_PREFIX)).map((line) => JSON.parse(line.slice(RESULT_PREFIX.length)) as RegistryResult);
  expect(results.map(({ module, passed, failures }) => ({ module: module.slice(root.length + 1), passed, failures }))).toEqual([
    { module: "registry/passing.tests.ts", passed: 2, failures: [] },
    { module: "registry/failing.tests.ts", passed: 0, failures: [{ test: "compares", message: "sum: expected 2, actual 1" }] },
  ]);
});
