import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dir, "..");

// test/stack and test/throw pin their own line numbers in stack-trace expectations.
const PINNED = /^test\/(stack|throw)\//;

const sources = () => [...new Bun.Glob("{scripts,src,examples,plugins,test}/**/*.ts").scanSync({ cwd: root })]
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => !path.endsWith(".d.ts") && !PINNED.test(path));

const literalRanges = (path: string, text: string): (readonly [number, number])[] => {
  const ranges: (readonly [number, number])[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isTemplateLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ranges.push([node.getStart(), node.getEnd()]);
    else node.forEachChild(visit);
  };
  visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true));
  return ranges;
};

const strayBlankLines = (path: string, text: string): string[] => {
  const literals = literalRanges(path, text);
  const lines = text.split("\n");
  const problems: string[] = [];
  let offset = 0;
  let previousBlank = false;
  let started = false;
  lines.forEach((line, index) => {
    const start = offset;
    offset += line.length + 1;
    const blank = line.trim() === "" && index < lines.length - 1 && !literals.some(([from, to]) => start > from && start < to);
    if (blank && !started) problems.push(`${path}:${index + 1}: leading blank line`);
    else if (blank && previousBlank) problems.push(`${path}:${index + 1}: second blank line in a row`);
    started ||= !blank;
    previousBlank = blank;
  });
  return problems;
};

test("[invariant] no source file starts with a blank line or holds two blank lines in a row outside a string", () => {
  expect(sources().flatMap((path) => strayBlankLines(path, readFileSync(join(root, path), "utf8")))).toEqual([]);
});

test("[invariant] the blank-line check catches planted blank lines and keeps those inside strings", () => {
  expect(strayBlankLines("planted.ts", "\nconst a = 1;\n\n\nconst b = `\n\n\n`;\n")).toEqual([
    "planted.ts:1: leading blank line",
    "planted.ts:4: second blank line in a row",
  ]);
});
