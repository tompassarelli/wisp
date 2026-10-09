



import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { programNumberRules } from "../plugins/number-rules";

const root = join(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "traps");

test("[spec #35] each fixture is rejected exactly on its marked lines", () => {
  const config = ts.readConfigFile(join(root, "test/tsconfig.traps.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, join(root, "test"));
  const files = readdirSync(fixtures).map((name) => join(fixtures, name));
  const program = ts.createProgram(files, options);
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...program.getSourceFiles().flatMap((file) => programNumberRules(ts, program, file)),
  ];
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
