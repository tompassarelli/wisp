import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "../scripts/compiler";
import { producePackage } from "../scripts/package";

test("installed package resolves bare imports and preserves Lua32 numeric/reload behavior", async () => {
  const root = join(import.meta.dir, "..");
  await mkdir(join(root, "build"), { recursive: true });
  const fixture = await mkdtemp(join(root, "build/package-consumer-"));
  try {
    const archive = join(fixture, "wisp.tgz");
    await producePackage(archive);
    await Bun.write(join(fixture, "package.json"), JSON.stringify({ private: true, dependencies: { wisp: "file:./wisp.tgz" } }));
    for (const file of ["entry.ts", "tsconfig.json", "perf.ts", "tsconfig.perf.json"]) await copyFile(join(import.meta.dir, "package", file), join(fixture, file));
    const install = Bun.spawnSync([process.execPath, "install", "--offline", "--ignore-scripts", "--silent"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect({ code: install.exitCode, stderr: install.stderr.toString().replace(/bun install[^\n]*\n|Saved lockfile\n/g, "") }).toEqual({ code: 0, stderr: "" });
    expect(await Bun.file(join(fixture, "node_modules/wisp/src/platform/hotReload.lua")).exists()).toBe(true);
    const host = Bun.spawnSync([process.execPath, "-e", "import { idiv } from 'wisp/src/sim/intMath'; import { mapCompiler } from 'wisp/scripts/compiler'; if (idiv(-2000000000, 3) !== -666666666 || typeof mapCompiler !== 'function') throw new Error('installed host import failed');"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect({ code: host.exitCode, stderr: host.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    const { diagnostics } = transpileProject(join(fixture, "tsconfig.json"));
    expect(report(diagnostics)).toBe("");
    const bundle = join(fixture, "output/map.lua");
    const run = Bun.spawnSync([process.env.LUA ?? "lua", join(import.meta.dir, "hot-reload-stub.lua"), bundle], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    expect(run.stdout.toString()).toContain("reload contract passed");
    // The headless runtime's emitted modules require each other; each resolves to the package's own Lua.
    expect(report(transpileProject(join(fixture, "tsconfig.perf.json")).diagnostics)).toBe("");
    const perf = Bun.spawnSync([process.env.LUA ?? "lua", join(fixture, "output/perf.lua"), bundle, join(fixture, "node_modules/wisp/src/natives/warcraft.d.ts")], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect({ code: perf.exitCode, stderr: perf.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    expect(perf.stdout.toString()).toStartWith("frames 30 step 100 problems 0\n");
  } finally {
    await rm(fixture, { recursive: true });
  }
}, 120_000);
