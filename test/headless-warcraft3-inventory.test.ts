import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { inventoryFixture } from "./warcraft3-inventory/fixture";
import { farmTest } from "../scripts/wisp/farmTest";

farmTest("the same inventory and unit native fixture passes in emitted Lua32", () => {
  expect(report(mapCompiler(join(import.meta.dir, "warcraft3-inventory/tsconfig.json"))())).toBe("");
  const result = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/warcraft3-inventory/inventory.lua")]);
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(result.stdout.toString().trim()).toBe(`Warcraft inventory: ${inventoryFixture()} checks passed`);
  console.info(result.stdout.toString().trim());
});
