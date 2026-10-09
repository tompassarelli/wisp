import { expect, test } from "bun:test";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dir, "..");
const browserPages = (file: string) => file.startsWith("scripts/wisp/browser/") || file === "scripts/wisp/reproViewerPage.ts" || file === "scripts/wisp/tunePage.ts";

const nameOf = (node: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node.name?.getText();
  if (ts.isConstructorDeclaration(node) && ts.isClassDeclaration(node.parent)) return node.parent.name?.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) return node.parent.name.getText();
  return undefined;
};
const called = (node: ts.CallExpression | ts.NewExpression) => ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText();

function violations(source: string): string[] {
  const tree = ts.createSourceFile("host.ts", source, ts.ScriptTarget.Latest, true);
  const edges = new Map<string, Set<string>>();
  const effectOwned = new Set<string>();
  const unowned = new Set<string>();
  const raw: { operation: string; owner: string | undefined; insideEffect: boolean }[] = [];
  const walk = (node: ts.Node, owner: string | undefined, insideEffect: boolean, effectArgument = false) => {
    const name = nameOf(node);
    if (name !== undefined) owner = name;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = node.parent;
      const callback = ts.isCallExpression(parent) && parent.arguments.includes(node) && parent.expression.getText().startsWith("Effect.");
      const tryCallback = ts.isPropertyAssignment(parent) && parent.name.getText() === "try";
      if (effectArgument && (callback || tryCallback)) insideEffect = true;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === "Effect") effectArgument = true;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = called(node);
      if (insideEffect) effectOwned.add(name);
      else if (owner === undefined) unowned.add(name);
      if (owner !== undefined && !insideEffect) {
        const targets = edges.get(owner) ?? new Set<string>();
        targets.add(name);
        edges.set(owner, targets);
      }
      const operation = node.expression.getText();
      if (/^Bun\.(spawn|spawnSync|sleep)$|^setTimeout$/.test(operation) || (ts.isNewExpression(node) && operation === "Promise")) raw.push({ operation, owner, insideEffect });
    }
    ts.forEachChild(node, child => walk(child, owner, insideEffect, effectArgument));
  };
  walk(tree, undefined, false);
  let changed = true;
  while (changed) {
    changed = false;
    for (const owned of [effectOwned, unowned]) for (const owner of [...owned]) for (const target of edges.get(owner) ?? []) {
      if (!owned.has(target)) { owned.add(target); changed = true; }
    }
  }
  return raw.filter(item => !item.insideEffect && (item.owner === undefined || (!effectOwned.has(item.owner) || unowned.has(item.owner)))).map(item => `${item.operation} outside Effect`);
}

test("[spec AGENTS.md] host process and wait boundaries belong to Effect", async () => {
  const problems: string[] = [];
  let scanned = 0;
  for (const file of new Bun.Glob("scripts/**/*.ts").scanSync(root)) {
    if (/\.tests?\.ts$/.test(file) || browserPages(file)) continue;
    scanned++;
    const source = await Bun.file(join(root, file)).text();
    problems.push(...violations(source).map(problem => `${file}: ${problem}`));
  }
  expect(scanned).toBeGreaterThanOrEqual(100);
  expect(problems).toEqual([]);
  for (const shell of ["Bun.spawn(['true'])", "setTimeout(() => {}, 1)", "await new Promise(resolve => resolve())"]) {
    expect(violations(`import { Effect } from 'effect'; ${shell}`)).not.toEqual([]);
    expect(violations(`import { Effect } from 'effect'; const run = async () => { ${shell}; }; run();`)).not.toEqual([]);
    expect(violations(`import { Effect } from 'effect'; Effect.succeed((async () => { ${shell}; })());`)).not.toEqual([]);
    expect(violations(`import { Effect } from 'effect'; const run = async () => { ${shell}; }; Effect.promise(run); run();`)).not.toEqual([]);
  }
});
