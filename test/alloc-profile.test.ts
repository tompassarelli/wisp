import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../host/toolchain/compiler";

const root = join(import.meta.dir, "..");
const build = join(root, "build/alloc-profile");

const ONE_TABLE = `collectgarbage("stop") local sink local before = collectgarbage("requested") sink = {} io.write(collectgarbage("requested") - before)`;

const definedAt = (bundle: string, name: string) => bundle.split("\n").findIndex((line) => line.includes(`function ${name}(`)) + 1;

test("the allocation sampler charges each map function exactly the tables it creates [invariant]", async () => {
  expect(report(mapCompiler(join(import.meta.dir, "allocProfile/tsconfig.json"))())).toBe("");
  expect(report(mapCompiler(join(import.meta.dir, "allocProfile/tsconfig.headless.json"))())).toBe("");
  const lua = process.env.LUA ?? "lua";
  const one = Number(Bun.spawnSync([lua, "-e", ONE_TABLE], { stdout: "pipe" }).stdout.toString());
  const bundle = await Bun.file(join(build, "map.lua")).text();
  const run = Bun.spawnSync([lua, join(build, "headless/headless.lua"), join(build, "map.lua"), join(root, "src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const charged = new Map(run.stdout.toString().split("\n").filter((line) => line.startsWith("alloc ")).map((line) => {
    const [, at = "", self = 0, inclusive = 0] = line.split(" ");
    return [Number(at), { self: Number(self), inclusive: Number(inclusive) }] as const;
  }));
  const tables = charged.get(definedAt(bundle, "tables"));
  const tick = charged.get(definedAt(bundle, "tick"));
  expect(one).toBeGreaterThan(0);
  expect(tables?.self).toBeGreaterThan(0);
  expect(tables?.self).toBe(2 * 60 * 50 * one);
  expect(tables?.inclusive).toBe(tables?.self);
  expect(charged.get(definedAt(bundle, "idle"))).toBeUndefined();
  expect(charged.get(definedAt(bundle, "____exports.start"))).toBeUndefined();
  expect(tick).toEqual({ self: 0, inclusive: tables?.self ?? -1 });
}, 120_000);
