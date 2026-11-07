import { expect } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { mapCompiler, report } from "../host/toolchain/compiler";
import { lua32 } from "../host/compile/lua32";
import { farmTest } from "../host/farm/farmTest";

const root = join(import.meta.dir, "..");

farmTest("[reference] numeric contracts pass in emitted Lua, rounding to nearest and toward zero", async () => {
  const diagnostics = mapCompiler(join(import.meta.dir, "tsconfig.lua.json"))();
  expect(report(diagnostics)).toBe("");
  const towardZero = process.env.TOWARD_ZERO_LUA ?? await Effect.runPromise(lua32("toward-zero"));
  // Warcraft's Lua rounds toward zero; the binary32 contracts assume a Lua rounding to nearest, f32 neither.
  for (const [lua, only, passed] of [[process.env.LUA ?? "lua", [], /(\d+) of \1 passed/], [towardZero, ["f32"], /([1-9]\d*) of \1 passed/]] as const) {
    const run = Bun.spawnSync([lua, join(root, "build/lua-tests/tests.lua"), ...only], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect({ lua, code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ lua, code: 0, stderr: "" });
    const counts = /(\d+) of (\d+) passed/.exec(run.stdout.toString());
    expect(counts).not.toBeNull();
    const [passed, total] = [Number(counts?.[1]), Number(counts?.[2])];
    expect(total).toBeGreaterThan(0);
    expect(passed).toBe(total);
  }
}, 600_000);
