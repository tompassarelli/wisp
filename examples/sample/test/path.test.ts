// The registered tests in Bun, then the same tests compiled to Lua and run in
// the 32-bit Lua that LUA names.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "wisp/scripts/compiler";
import { farmTest } from "wisp/scripts/wisp/farmTest";
import { registeredTests } from "wisp/src/runtime/testing";
import "../src/path.tests";

for (const { name, run } of registeredTests) test(name, run);

farmTest("[reference] the registered tests pass in 32-bit Lua", () => {
  expect(report(mapCompiler(join(import.meta.dir, "../tsconfig.tests.json"))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/tests/tests.lua")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain(`${registeredTests.length} of ${registeredTests.length} passed`);
});
