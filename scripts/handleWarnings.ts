import ts from "typescript";
import { relative } from "node:path";

export function reportHandleWarnings(warnings: readonly ts.Diagnostic[]): string {
  return warnings.map(w => {
    const position = w.file?.getLineAndCharacterOfPosition(w.start ?? 0);
    return `${relative(process.cwd(), w.file?.fileName ?? "")}:${(position?.line ?? 0) + 1}:${(position?.character ?? 0) + 1}: warning TS${w.code}: ${ts.flattenDiagnosticMessageText(w.messageText, "\n")}`;
  }).join("\n");
}

interface Allocation {
  readonly call: ts.CallExpression;
  readonly cleanup: string;
  readonly scope: ts.Node;
  readonly symbol: ts.Symbol | undefined;
  unknown: boolean;
  cleaned: boolean;
  cleanupAt: number;
}


export function handleWarnings(program: ts.Program): readonly ts.Diagnostic[] {
  const checker = program.getTypeChecker();
  const warnings: ts.Diagnostic[] = [];
  const scopeOf = (node: ts.Node): ts.Node => {
    let scope = node.parent;
    while (!ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
    return scope;
  };
  const native = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name
    && (checker.getSymbolAtLocation(node)?.declarations?.every(d => d.getSourceFile().isDeclarationFile) ?? false);
  const conditional = (node: ts.Node, scope: ts.Node): boolean => {
    for (let at = node.parent; at !== scope; at = at.parent) {
      if (ts.isIfStatement(at) || ts.isIterationStatement(at, false) || ts.isSwitchStatement(at)
        || ts.isTryStatement(at) || ts.isConditionalExpression(at)
        || (ts.isBinaryExpression(at) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(at.operatorToken.kind))) return true;
    }
    return false;
  };
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file)) continue;
    const allocations: Allocation[] = [];
    const collect = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && (native(node.expression, "Location") || native(node.expression, "CreateGroup"))) {
        const declaration = node.parent;
        const symbol = ts.isVariableDeclaration(declaration) && declaration.initializer === node && ts.isIdentifier(declaration.name)
          ? checker.getSymbolAtLocation(declaration.name) : undefined;
        const scope = scopeOf(node);
        allocations.push({ call: node, cleanup: native(node.expression, "Location") ? "RemoveLocation" : "DestroyGroup",
          scope, symbol, unknown: (symbol === undefined && !ts.isExpressionStatement(declaration)) || ts.isSourceFile(scope) || conditional(node, scope), cleaned: false, cleanupAt: Infinity });
      }
      ts.forEachChild(node, collect);
    };
    collect(file);
    for (const allocation of allocations) {
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && allocation.symbol !== undefined && checker.getSymbolAtLocation(node) === allocation.symbol
          && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
          const call = node.parent;
          const directCleanup = ts.isCallExpression(call) && call.arguments.length === 1 && call.arguments[0] === node
            && native(call.expression, allocation.cleanup) && ts.isExpressionStatement(call.parent);
          if (directCleanup && scopeOf(node) === allocation.scope && !conditional(node, allocation.scope) && call.pos > allocation.call.pos) {
            allocation.cleaned = true;
            allocation.cleanupAt = Math.min(allocation.cleanupAt, call.pos);
          }
          else allocation.unknown = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      const exits = (node: ts.Node): void => {
        if ((ts.isReturnStatement(node) || ts.isThrowStatement(node)) && scopeOf(node) === allocation.scope
          && node.pos > allocation.call.pos && node.pos < allocation.cleanupAt) allocation.unknown = true;
        ts.forEachChild(node, exits);
      };
      exits(file);
      if (allocation.cleaned && !allocation.unknown) continue;
      warnings.push({ category: ts.DiagnosticCategory.Warning, code: 9501, file,
        start: allocation.call.getStart(file), length: allocation.call.getWidth(file),
        messageText: allocation.unknown ? `Handle ownership UNKNOWN: ${allocation.call.expression.getText(file)} may escape or follow conditional control flow; check ${allocation.cleanup}.`
          : `Unmatched ${allocation.call.expression.getText(file)}: no ${allocation.cleanup} in this straight-line scope.` });
    }
  }
  return warnings;
}
