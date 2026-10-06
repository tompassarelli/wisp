import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";

const root = join(import.meta.dir, "..");

let compiled: string | undefined;
/** The fixture bundle's path, compiled once for the tests that drive it in Lua. */
function runtimeBundle(): string {
  if (compiled === undefined) {
    expect(report(mapCompiler(join(import.meta.dir, "tsconfig.runtime.json"))())).toBe("");
    compiled = join(root, "build/runtime-tests/map.lua");
  }
  return compiled;
}

test("configured runtime reload preserves globals and replaces handlers", () => {
  const bundle = runtimeBundle();
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "hot-reload-stub.lua"), bundle], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("reload contract passed");
  const lockstep = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "hot-reload-lockstep.lua"), bundle], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: lockstep.exitCode, stderr: lockstep.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(lockstep.stdout.toString()).toContain("lockstep reload contract passed");
  const polling = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "hot-reload-poll.lua"), bundle], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: polling.exitCode, stderr: polling.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(polling.stdout.toString()).toContain("poll rate contract passed");
});

test("an error report is displayed unless the map turns error text off, and is written to the error file either way", () => {
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "error-text-stub.lua"), runtimeBundle()], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("error text contract passed");
});

test("numeric and payload contracts pass in emitted Lua", () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.lua.json"))();
  expect(report(diagnostics)).toBe("");
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(root, "build/lua-tests/tests.lua")], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString()).toContain("15 of 15 passed");
});
