import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseNativeDeclarations } from "../src/headless/declarations";
import { mapCompiler, report } from "../scripts/compiler";
import { sceneryFixture } from "./warcraft3-scenery/fixture";

const declarationPath = join(import.meta.dir, "../src/natives/warcraft.d.ts");
test("Warcraft 3 scenery models every native using the real declarations", async () => {
  const count = sceneryFixture(parseNativeDeclarations(await Bun.file(declarationPath).text()));
  expect(count).toBe(92);
});
test("Warcraft 3 scenery runs the same fixture in emitted Lua32", () => {
  expect(report(mapCompiler(join(import.meta.dir, "warcraft3-scenery/tsconfig.json"))())).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "../build/warcraft3-scenery/scenery.lua"), declarationPath], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trim()).toBe("scenery 92 natives passed");
});
