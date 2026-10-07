import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { parseNativeDeclarations } from "../src/headless/declarations";
import { coreFixture } from "./warcraft3-core/fixture";
import { allWarcraft3Fixtures } from "./warcraft3-core/all";

test("Warcraft 3 cooldown, aura, input, trigger and effect natives are modeled in Bun", async () => {
  expect(coreFixture(parseNativeDeclarations(await Bun.file(join(import.meta.dir, "../src/natives/warcraft.d.ts")).text()))).toBeGreaterThan(30);
});

test("every 3.0 and 3.0.1 added native has an executed Bun fixture and no unmodelled calls", async () => {
  expect(allWarcraft3Fixtures(parseNativeDeclarations(await Bun.file(join(import.meta.dir, "../src/natives/warcraft.d.ts")).text()))).toBe(145);
});

test("the same Warcraft 3 native cases pass in 32-bit Lua", () => {
  expect(report(mapCompiler(join(import.meta.dir, "warcraft3-core/tsconfig.json"))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/warcraft3-core/core.lua"), join(import.meta.dir, "../src/natives/warcraft.d.ts")]);
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("natives, 0 unmodelled");
});
