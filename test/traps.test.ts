// The map compiler rejects code that would compile but compute differently in
// Warcraft (#35). Each fixture marks the lines that must be rejected; every
// other line must compile. Emitting despite errors lets the type errors of one
// fixture and the plugin's rejections of another surface together.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { parseConfigFileWithSystem, transpileFiles } from "typescript-to-lua";

const root = join(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "traps");

test("each fixture is rejected exactly on its marked lines", () => {
  const { options } = parseConfigFileWithSystem(join(root, "test/tsconfig.traps.json"));
  const { luaBundle, luaBundleEntry, ...unbundled } = options;
  const files = readdirSync(fixtures).map((name) => join(fixtures, name));
  const { diagnostics } = transpileFiles(files, { ...unbundled, rootDir: root, noEmitOnError: false }, () => {});
  for (const file of files) {
    const source = ts.sys.readFile(file) ?? "";
    const marked = source.split("\n").flatMap((line, index) => (line.includes("// rejected") ? [index + 1] : []));
    const rejected = diagnostics
      .filter((diagnostic) => diagnostic.file?.fileName === file && diagnostic.start !== undefined)
      .map((diagnostic) => diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line + 1);
    expect({ file, lines: [...new Set(rejected)].sort((a, b) => a - b) }).toEqual({ file, lines: marked });
  }
  expect(files.length).toBe(6);
});
