import { expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { producePackage } from "../host/toolchain/package";
import { farmTest } from "../host/farm/farmTest";

farmTest("[boundary] the installed package's syntheticBaseMap export writes a base map the sample's map build accepts", async () => {
  const root = join(import.meta.dir, "..");
  await mkdir(join(root, "build"), { recursive: true });
  const fixture = await mkdtemp(join(root, "build/synthetic-consumer-"));
  const out = await mkdtemp(join(tmpdir(), "wisp-synthetic-build-"));
  try {
    const archive = join(fixture, "wisp.tgz");
    await producePackage(archive);
    await Bun.write(join(fixture, "package.json"), JSON.stringify({ private: true, dependencies: { wisp: "file:./wisp.tgz" } }));
    const install = Bun.spawnSync([process.execPath, "install", "--offline", "--ignore-scripts", "--silent"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect({ code: install.exitCode, stderr: install.stderr.toString().replace(/bun install[^\n]*\n|Saved lockfile\n/g, "") }).toEqual({ code: 0, stderr: "" });
    const script = Bun.resolveSync("wisp/scripts/wisp/syntheticBaseMap", fixture);
    expect(script).toBe(join(fixture, "node_modules/wisp/host/toolchain/syntheticBaseMap.ts"));
    const packager = join(root, "build/tools/map-pack");
    const base = join(out, "base.w3x");
    const written = Bun.spawnSync([process.execPath, script, packager, base], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect({ code: written.exitCode, stderr: written.stderr.toString() }).toEqual({ code: 0, stderr: "" });
    const map = join(out, "sample.w3x");
    const built = Bun.spawnSync([process.execPath, join(root, "examples/sample/scripts/sample.ts"), "map", "build", "--base", base, "--out", map], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect({ code: built.exitCode, failure: built.exitCode === 0 ? "" : built.stderr.toString() }).toEqual({ code: 0, failure: "" });
    const lua = join(out, "war3map.lua");
    expect(Bun.spawnSync([packager, "extract", map, lua]).exitCode).toBe(0);
    expect(await readFile(lua, "utf8")).toContain("wispTs.start");
  } finally {
    await rm(fixture, { recursive: true });
    await rm(out, { recursive: true });
  }
}, 300_000);
