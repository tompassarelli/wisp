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
