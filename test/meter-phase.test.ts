import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../host/toolchain/compiler";

const root = join(import.meta.dir, "..");
const build = join(root, "build/meter-phase");

const bytes = (line: string) => /^p\d+ (alloc-kb|runtime-alloc-kb|module-alloc-bytes) /.test(line);

function meter(bundle: string): string[] {
  const run = Bun.spawnSync([process.env.LUA ?? "lua", join(build, "headless/headless.lua"), bundle, join(root, "src/natives/warcraft.d.ts")], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  return run.stdout.toString().split("\n").filter(bytes).map((line) => line.replace(/ start=.*| mean=.*/, ""));
}

test("[invariant] moving the count hook's phase by a few instructions before each native call moves no byte between the runtime and the map's modules, and leaves no total negative", async () => {
  expect(report(mapCompiler(join(import.meta.dir, "meterPhase/tsconfig.json"))())).toBe("");
  expect(report(mapCompiler(join(import.meta.dir, "meterPhase/tsconfig.headless.json"))())).toBe("");
  const source = await Bun.file(join(build, "map.lua")).text();
  expect(source).toContain("local PHASE = 1357");
  const runs: string[][] = [];
  for (const spin of [1357, 1359, 1362, 1371, 1380]) {
    const path = join(build, `map-${spin}.lua`);
    await Bun.write(path, source.replace("local PHASE = 1357", `local PHASE = ${spin}`));
    runs.push(meter(path));
  }
  const [first = [], ...rest] = runs;
  expect(first.some((line) => line.includes("module-alloc-bytes"))).toBe(true);
  expect(first.some((line) => line.includes("runtime-alloc-kb") && !line.includes("total=0 "))).toBe(true);
  expect(first.filter((line) => /total=-/.test(line))).toEqual([]);
  for (const run of rest) expect(run).toEqual(first);
}, 120_000);
