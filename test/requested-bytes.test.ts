import { expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../scripts/compiler";

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
