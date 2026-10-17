import { expect, test } from "bun:test";
import { Effect } from "effect";
import { lua32 } from "../scripts/wisp/compile/lua32";

const LAYOUT = `collectgarbage("stop")
local t = {}
for i = 1, 64 do t[{}] = i; t["k" .. i] = -i end
local order = {}
for _, v in pairs(t) do order[#order + 1] = v end
local sources = {}
for i = 1, 2 do sources[i] = load("return 1", "=" .. string.rep("s", 40) .. i) end
local before = collectgarbage("count")
for _ = 1, 200 do
  for i = 1, #sources do debug.getinfo(sources[i], "S") end
end
io.write(table.concat(order, ","), " ", collectgarbage("count") - before)`;

const PADDINGS = Array.from({ length: 54 }, (_, index) => index * 16);

test.skipIf(process.platform !== "linux")("[invariant] each Lua32 repeats its key order and allocation whatever the second, address randomization and environment size", async () => {
  const luas = await Effect.runPromise(Effect.all([lua32("stock"), lua32("toward-zero")]));
  const layouts = (padding: number) => luas.map((lua) => {
    const result = Bun.spawnSync([lua, "-e", LAYOUT], { env: { ...process.env, WISP_LAYOUT_PADDING: "x".repeat(padding) }, stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    return result.stdout.toString();
  });
  const first = layouts(0);
  for (const padding of PADDINGS) expect(layouts(padding)).toEqual(first);
  await Bun.sleep(1100);
  expect(layouts(0)).toEqual(first);
});
