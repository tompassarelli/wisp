import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dir, "..");
const browserPage = (file: string) => file.startsWith("scripts/wisp/browser/") || file === "scripts/wisp/reproViewerPage.ts" || file === "scripts/wisp/tunePage.ts";

const rawOperation = (node: ts.Node): boolean => {
  if (ts.isNewExpression(node)) return ts.isIdentifier(node.expression) && node.expression.text === "Promise";
  if (!ts.isCallExpression(node)) return false;
  return /^(?:Bun\.(?:spawn|spawnSync|sleep|sleepSync)|setTimeout|spawnSync)$/.test(node.expression.getText().replace(/\s+/g, ""));
};

const inEffect = (node: ts.Node): boolean => {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isCallExpression(parent) && /^Effect\./.test(parent.expression.getText())) return true;
  }
  return false;
};

export const effectBoundaryViolations = (file: string, source: string): number[] => {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (rawOperation(node) && !inEffect(node)) lines.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return lines;
};

if (import.meta.main) {
  const problems: string[] = [];
  for (const file of new Bun.Glob("scripts/**/*.ts").scanSync(root)) {
    if (/\.tests?\.ts$/.test(file) || browserPage(file)) continue;
    problems.push(...effectBoundaryViolations(file, readFileSync(join(root, file), "utf8")).map(line => `${file}:${line} raw process or wait outside Effect (wisp:docs/host-tools.md)`));
  }
  for (const problem of problems) console.error(problem);
  process.exit(problems.length === 0 ? 0 : 1);
}
