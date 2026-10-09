import { expect, test } from "bun:test";
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

const violations = (file: string, source: string): number[] => {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (rawOperation(node) && !inEffect(node)) lines.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return lines;
};

test("[spec AGENTS.md] host process and wait boundaries belong to Effect", async () => {
  const problems: string[] = [];
  let scanned = 0;
  for (const file of new Bun.Glob("scripts/**/*.ts").scanSync(root)) {
    if (/\.tests?\.ts$/.test(file) || browserPage(file)) continue;
    scanned++;
    const source = await Bun.file(join(root, file)).text();
    problems.push(...violations(file, source).map(line => `${file}:${line} raw process or wait outside Effect`));
  }
  expect(scanned).toBeGreaterThanOrEqual(100);
  expect(problems).toEqual([]);
  for (const shell of ["Bun.spawn(['true'])", "Bun . spawn(['true'])", "setTimeout(() => {}, 1)", "await new Promise(resolve => resolve())"]) {
    expect(violations("x.ts", `import { Effect } from 'effect'; const run = async () => { ${shell}; }; run();`)).not.toEqual([]);
  }
});
