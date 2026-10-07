import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { mapCompiler, report } from "../scripts/compiler";
import { towardZeroLua } from "../scripts/wisp/towardZeroLua";

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

test("numeric, payload and record text contracts pass in emitted Lua, rounding to nearest and toward zero", async () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.lua.json"))();
  expect(report(diagnostics)).toBe("");
  // TOWARD_ZERO_LUA as in toward-zero.test.ts: CI builds it with make.
  const towardZero = process.env.TOWARD_ZERO_LUA ?? await Effect.runPromise(towardZeroLua(join(root, "build/toward-zero-lua")));
  // Warcraft's Lua rounds toward zero; the binary32 contracts assume a Lua rounding to nearest, f32 and the record text neither.
  for (const [lua, only, passed] of [[process.env.LUA ?? "lua", [], "23 of 23 passed"], [towardZero, ["record text"], "4 of 4 passed"], [towardZero, ["f32"], "6 of 6 passed"]] as const) {
    const run = Bun.spawnSync([lua, join(root, "build/lua-tests/tests.lua"), ...only], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect({ lua, code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ lua, code: 0, stderr: "" });
    expect(run.stdout.toString()).toContain(passed);
  }
}, 600_000);
