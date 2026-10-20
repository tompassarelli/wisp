import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../host/toolchain/compiler";

const root = join(import.meta.dir, "..");
const build = join(root, "build/requested-bytes");

const INERT = `local function inert() return { ${Array.from({ length: 2048 }, (_, index) => `"k${index}", "inert${index}"`).join(", ")} } end\n`;

function withInertFunction(bundle: string): string {
  const header = /^\["[^"]*requestedBytes\.main"\] = function\(\.\.\.\) \n/m.exec(bundle);
  if (header === null) throw new Error("the fixture bundle has no requestedBytes.main module");
  const at = header.index + header[0].length;
  return bundle.slice(0, at) + INERT + bundle.slice(at);
}

function frameSamples(bundle: string): string[] {
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(build, "headless/headless.lua"), bundle, join(root, "src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  return run.stdout.toString().split("\n").filter((line) => line.startsWith("frame ")).map((line) => line.replace(/ lua-us=\d+/, ""));
}

test("[invariant] an inert, never-called function moves no frame's requested bytes, though its string constants are interned and the string table grows elsewhere", async () => {
  expect(report(mapCompiler(join(import.meta.dir, "requestedBytes/tsconfig.json"))())).toBe("");
  expect(report(mapCompiler(join(import.meta.dir, "requestedBytes/tsconfig.headless.json"))())).toBe("");
  const bundle = join(build, "map.lua");
  const inert = join(build, "map-inert.lua");
  await Bun.write(inert, withInertFunction(await Bun.file(bundle).text()));
  const plain = frameSamples(bundle);
  expect(plain).toHaveLength(240);
  expect(plain.every((line) => !line.includes(" alloc-bytes=0 "))).toBe(true);
  expect(frameSamples(inert)).toEqual(plain);
}, 120_000);

const GROWN_AND_PRESIZED = `collectgarbage("stop")
local keys = {}
for i = 1, 512 do keys[i] = "[" .. i * 100000 .. "]=" .. i end
local presize = load("return {" .. table.concat(keys, ",") .. "}")
local before = collectgarbage("requested")
local presized = presize()
local constructed = collectgarbage("requested") - before
before = collectgarbage("requested")
local grown = {}
for i = 1, 512 do grown[i * 100000] = i end
io.write(collectgarbage("requested") - before, " ", constructed)`;

test("[invariant] a table grown key by key charges what one presized to the same size charges, so a rehash charges its parts' net growth as Lua's collector debt does", () => {
  const run = Bun.spawnSync([process.env.LUA ?? "lua", "-e", GROWN_AND_PRESIZED], { stdout: "pipe", stderr: "pipe" });
  expect(run.stderr.toString()).toBe("");
  const [grown, presized] = run.stdout.toString().split(" ").map(Number);
  expect(presized).toBeGreaterThan(512 * 8);
  expect(grown).toBe(presized);
});

const HOOKED = `collectgarbage("stop")
local step = tonumber(arg[1])
local hooks = 0
local function count()
  local info = debug.getinfo(2, "Sl")
  hooks = hooks + (info and 1 or 0)
  debug.sethook(count, "", step)
end
local sink
local function idle(n) local x = 0 for i = 1, n do x = x + i * 2 end return x end
local function tables(n) for i = 1, n do sink = {} end end
local function measure(f, n, hooked)
  local before = collectgarbage("requested")
  if hooked then debug.sethook(count, "", step) end
  f(n)
  debug.sethook()
  return collectgarbage("requested") - before
end
measure(idle, 1, true)
local one = measure(tables, 1, false)
local inCoroutine = coroutine.wrap(function() return measure(idle, 10000, true) end)()
io.write(measure(idle, 10000, true), " ", inCoroutine, " ", measure(tables, 1000, true), " ", one, " ", hooks)`;

for (const step of [1, 100, 1000]) {
  test(`[invariant] a count hook every ${step} instructions charges none of its own allocation: allocation-free code requests 0 bytes and 1000 new tables request 1000 times one table's bytes`, () => {
    const run = Bun.spawnSync([process.env.LUA ?? "lua", "-", String(step)], { stdin: new TextEncoder().encode(HOOKED), stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).toBe("");
    const [idle, inCoroutine, tables, one, hooks] = run.stdout.toString().split(" ").map(Number);
    expect(hooks).toBeGreaterThan(40_000 / step);
    expect({ idle, inCoroutine }).toEqual({ idle: 0, inCoroutine: 0 });
    expect(one).toBeGreaterThan(0);
    expect(tables).toBe(1000 * (one ?? 0));
  });
}
