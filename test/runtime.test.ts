import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";
import { checksum } from "../src/runtime/payload";

const root = join(import.meta.dir, "..");

test("configured runtime reload preserves globals and replaces handlers", async () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.runtime.json"))();
  expect(report(diagnostics)).toBe("");
  const bundle = join(root, "build/runtime-tests/map.lua");
  const bytes = new Uint8Array(await Bun.file(bundle).arrayBuffer());
  const expected = checksum(bytes.length, (index) => bytes[index] ?? 0);
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "hot-reload-stub.lua"), bundle, expected], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("reload contract passed");
});

test("numeric and payload contracts pass in emitted Lua", () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.lua.json"))();
  expect(report(diagnostics)).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(root, "build/lua-tests/tests.lua")], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("7 of 7 passed");
});
