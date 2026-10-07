import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("the native packager grows a full MPQ and preserves existing entries", () => {
  const build = join(import.meta.dir, "../build");
  mkdirSync(build, { recursive: true });
  const work = mkdtempSync(join(build, "map-pack-"));
  const prefix = process.env.STORMLIB_PREFIX ?? (() => {
    const result = Bun.spawnSync(["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#stormlib"]);
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  })();
  const binary = join(work, "regression");
  const compiler = process.env.CC === undefined ? ["nix", "shell", "nixpkgs#gcc", "--command", "gcc"] : [process.env.CC];
  const compiled = Bun.spawnSync([...compiler, `-I${prefix}/include`, join(import.meta.dir, "../native/map-pack.test.c"),
    `-L${prefix}/lib`, `-Wl,-rpath,${prefix}/lib`, "-lstorm", "-o", binary]);
  expect({ code: compiled.exitCode, stderr: compiled.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const source = join(work, "source.txt");
  writeFileSync(source, "synthetic archive contents");
  const result = Bun.spawnSync([binary, join(work, "synthetic.mpq"), source]);
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(result.stdout.toString()).toContain("existing entries preserved");
});
