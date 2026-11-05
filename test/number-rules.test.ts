import { readdir } from "node:fs/promises";

import { expect } from "bun:test";
import { join, relative } from "node:path";
import ts from "typescript";
import { parseConfigFileWithSystem, transpileFiles } from "typescript-to-lua";
import { NUMBER_RULE_CODE } from "../plugins/number-rules";
import { farmTest } from "../host/farm/farmTest";

const root = join(import.meta.dir, "..");

const line = (diagnostic: ts.Diagnostic, cwd: string) => {
  const file = diagnostic.file!;
  const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start!);
  return `${relative(cwd, file.fileName)}(${line + 1},${character + 1}): ${ts.DiagnosticCategory[diagnostic.category]} TS${diagnostic.code}`;
};

farmTest("[spec #7] a number or string tested for truthiness fails compilation on its line; booleans and objects that may be undefined pass", async () => {
  const fixture = join(import.meta.dir, "traps/truthiness.ts");
  const { options } = parseConfigFileWithSystem(join(root, "test/tsconfig.traps.json"));
  const { luaBundle, luaBundleEntry, ...unbundled } = options;
  const { diagnostics } = transpileFiles([fixture], { ...unbundled, rootDir: root, noEmitOnError: false }, () => {});
  const reported = diagnostics.filter((diagnostic) => diagnostic.code === NUMBER_RULE_CODE).map((diagnostic) => line(diagnostic, root));
  const lines = (await Bun.file(fixture).text()).split("\n");
  const rejected = lines.flatMap((text, index) => {
    const form = /\/\/ rejected: (.*)$/.exec(text)?.[1];
    return form === undefined ? [] : [`test/traps/truthiness.ts(${index + 1}): Error TS${NUMBER_RULE_CODE}`];
  });
  expect(reported.map((report) => report.replace(/,\d+\)/, ")"))).toEqual(rejected);
  // Every other trap fixture fails compilation on exactly the lines marked rejected.
  const traps = join(import.meta.dir, "traps");
  const others = (await readdir(traps)).filter((name) => name !== "truthiness.ts").map((name) => join(traps, name));
  const failed = transpileFiles(others, { ...unbundled, rootDir: root, noEmitOnError: false }, () => {}).diagnostics
    .filter((diagnostic) => diagnostic.file !== undefined && diagnostic.category === ts.DiagnosticCategory.Error).map((diagnostic) => line(diagnostic, root).replace(/,\d+\).*$/, ")"));
  const marked = (await Promise.all(others.map(async (file) => (await Bun.file(file).text()).split("\n")
    .flatMap((text, index) => text.includes("// rejected") ? [`${relative(root, file)}(${index + 1})`] : [])))).flat();
  expect([...new Set(failed)].sort()).toEqual(marked.sort());
}, 120_000);
