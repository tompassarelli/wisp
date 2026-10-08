import { expect } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { farmTest } from "../scripts/wisp/farmTest";

farmTest("[spec docs/stack-traces.md] Warcraft errors retain TypeScript frames and Lua return/unwind semantics without debug", () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.stack.json"))();
  expect(report(diagnostics)).toBe("");
  const run = Bun.spawnSync([
    process.env.LUA ?? "lua", join(import.meta.dir, "stack-stub.lua"),
    join(import.meta.dir, "../build/stack-tests/map.lua"),
  ], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const output = run.stdout.toString();
  expect(output).toContain("Error: original failure");
  expect(output).toContain("test/stack/entry.ts:6: in deepest");
  expect(output).toContain("test/stack/entry.ts:10: in invoke");
  expect(output).toContain("test/stack/entry.ts:14: in nested");
  expect(output).toContain("stack and unwind contract passed");
});

farmTest("[spec docs/stack-traces.md] an uninstrumented bundle reports each thrown value's TypeScript throw site without debug", () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.throw.json"))();
  expect(report(diagnostics)).toBe("");
  const run = Bun.spawnSync([
    process.env.LUA ?? "lua", join(import.meta.dir, "throw-stub.lua"),
    join(import.meta.dir, "../build/throw-tests/map.lua"),
  ], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const [thrown, thrownMessage, rethrown, rethrownMessage, fault, faultMessage, ...rest] = run.stdout.toString().split("\n");
  expect([thrown, thrownMessage, rethrown, rethrownMessage, fault, rest]).toEqual([
    "error 1 in thrown", "throw/entry.ts:7: Error: thrown failure",
    "error 2 in rethrown", "throw/entry.ts:7: Error: rethrown failure",
    "error 3 in fault", [""],
  ]);
  // A runtime fault keeps its Lua position after a caught throw.
  expect(faultMessage).toMatch(/^\S*map\.lua:\d+: attempt to call a nil value \(global 'MissingNative'\)$/);
});
