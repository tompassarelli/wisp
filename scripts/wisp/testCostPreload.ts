import { afterAll, afterEach, beforeEach } from "bun:test";
import { Effect } from "effect";
import { appendFileSync, chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { steppedFrames } from "../../src/headless/frameCount";
import { FARM_TEST_RUNNING } from "./farmTest";
import { provideLua32Env } from "./lua32";
import { TEST_CEILING_FRAMES, TEST_CEILING_LUA_INSTRUCTIONS, TEST_COST_OUT_ENV } from "./testCost";

const out = process.env[TEST_COST_OUT_ENV] ?? "";
const HOOK_INSTRUCTIONS = 1_000_000;

await Effect.runPromise(provideLua32Env);
const wrappers = mkdtempSync(join(tmpdir(), "wisp-test-lua-"));
const counts = join(wrappers, "instructions");
writeFileSync(counts, "");
// Each Lua32 child appends one 2-byte line per million instructions; a script that sets its own hook stops the count.
const prelude = `local o,p=io.open,${JSON.stringify(counts)} debug.sethook(function() local f=o(p,"a") if f then f:write("1\\n") f:close() end end,"",${HOOK_INSTRUCTIONS})`;
for (const name of ["LUA", "TOWARD_ZERO_LUA"]) {
  const real = process.env[name];
  if (real === undefined) continue;
  const wrapper = join(wrappers, name);
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(real)} -e '${prelude}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  process.env[name] = wrapper;
}
const luaInstructions = (): number => (statSync(counts).size / 2) * HOOK_INSTRUCTIONS;

const seconds = (): number => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1e6;
};

{
  const costs = new Map<string, { tests: number; cpu: number; max: number; maxLuaInstructions: number; maxFrames: number }>();
  const charge = (unit: string, tests: number, cpu: number, lua: number, frames: number) => {
    const before = costs.get(unit) ?? { tests: 0, cpu: 0, max: 0, maxLuaInstructions: 0, maxFrames: 0 };
    const counted = tests > 0;
    costs.set(unit, {
      tests: before.tests + tests, cpu: before.cpu + cpu, max: counted ? Math.max(before.max, cpu) : before.max,
      maxLuaInstructions: counted ? Math.max(before.maxLuaInstructions, lua) : before.maxLuaInstructions,
      maxFrames: counted ? Math.max(before.maxFrames, frames) : before.maxFrames,
    });
  };
  const write = (line: string) => {
    if (out !== "") appendFileSync(out, `${line}\n`);
  };
  const file = () => relative(process.cwd(), Bun.main);
  let mark = { cpu: seconds(), lua: luaInstructions(), frames: steppedFrames.count };
  const since = () => {
    const now = { cpu: seconds(), lua: luaInstructions(), frames: steppedFrames.count };
    const used = { cpu: now.cpu - mark.cpu, lua: now.lua - mark.lua, frames: now.frames - mark.frames };
    mark = now;
    return used;
  };
  beforeEach(() => {
    const used = since();
    charge(file(), 0, used.cpu, used.lua, used.frames);
  });
  afterEach(() => {
    const used = since();
    charge(file(), 1, used.cpu, used.lua, used.frames);
    const globals = globalThis as Record<string, unknown>;
    const farm = globals[FARM_TEST_RUNNING] === true;
    globals[FARM_TEST_RUNNING] = false;
    if (farm) return;
    if (used.lua > TEST_CEILING_LUA_INSTRUCTIONS) {
      throw new Error(`${file()}: this test ran ${used.lua / 1e6}M Lua32 instructions, over the ${TEST_CEILING_LUA_INSTRUCTIONS / 1e6}M ceiling per test; shrink it or move it to the farm`);
    }
    if (used.frames > TEST_CEILING_FRAMES) {
      throw new Error(`${file()}: this test stepped ${used.frames} headless frames, over the ${TEST_CEILING_FRAMES}-frame ceiling per test; shrink it or move it to the farm`);
    }
  });
  afterAll(() => {
    const used = since();
    charge(file(), 0, used.cpu, used.lua, used.frames);
    for (const [unit, cost] of costs) write(JSON.stringify({ unit, ...cost }));
  });
}
