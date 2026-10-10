import { expect, test } from "bun:test";
import { join } from "node:path";
import { coverageFixture } from "./coverage/fixture";
import { mapCompiler, report } from "../scripts/compiler";
import { farmTest } from "../scripts/wisp/farmTest";

test("equal defaults fail coverage, modeled and intentional calls pass in Bun", coverageFixture);

farmTest("equal defaults fail coverage, modeled and intentional calls pass in emitted Lua", () => {
  expect(report(mapCompiler(join(import.meta.dir, "tsconfig.coverage.json"))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/coverage-tests/coverage.lua")]);
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("native coverage contract passed");
});
