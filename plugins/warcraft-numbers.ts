// Warcraft's Lua uses 32-bit integers that wrap silently and binary32 floats,
// so TypeScriptToLua's defaults would change results there. This plugin:
// - keeps literals written with a decimal point or exponent as Lua floats (1.0
//   would print as the integer 1, and `x * 2.0` could stay an integer and
//   overflow), matching Wurst's real literals;
// - compiles floorDiv and floorMod from src/sim/intMath.ts to Lua's exact
//   integer `//` and `%`;
// - compiles f32(x) from src/sim/f32.ts and Math.fround(x), binary32 rounding
//   on the host, to x;
// - rejects code that would compile but compute differently in Warcraft:
//   decimal literals that aren't binary32 values, `%`, `>>>`, Math.floor(a / b),
//   and runtime services without a deterministic Lua meaning;
// - rejects type escapes in game code (tests excepted): `any`, `as unknown as`
//   and non-null `!`, which assert what the code should check.
// Node, Bun and DOM APIs need no rule: the map tsconfig doesn't declare them.
import * as ts from "typescript";
import * as tstl from "typescript-to-lua";
import { LuaPrinter } from "typescript-to-lua";

const floatLiterals = new WeakSet<tstl.NumericLiteral>();

class WarcraftNumberPrinter extends LuaPrinter {
  override printNumericLiteral(expression: tstl.NumericLiteral) {
    const text = String(expression.value);
    if (floatLiterals.has(expression) && Number.isInteger(expression.value) && !/[eE]/.test(text)) {
      return this.createSourceNode(expression, `${text}.0`);
    }
    return super.printNumericLiteral(expression);
  }
}

/** Whether `name` at this node refers to the declaration in a file ending with `fileSuffix`. */
function declaredIn(node: ts.Node, checker: ts.TypeChecker, fileSuffix: string): boolean {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  return declaration !== undefined && declaration.getSourceFile().fileName.endsWith(fileSuffix);
}

const isStandardLibrary = (node: ts.Node, checker: ts.TypeChecker) =>
  checker.getSymbolAtLocation(node)?.declarations?.some((declaration) => /\/typescript\/lib\/lib\.[^/]*\.d\.ts$/.test(declaration.getSourceFile().fileName)) ?? false;

// Matched structurally: calls TSTL synthesizes, as for optional chains, have no source text.
const isMathMember = (node: ts.Node, member: string): node is ts.PropertyAccessExpression =>
  ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Math" && node.name.text === member;

const integerOperators: Record<string, tstl.BinaryOperator> = {
  floorDiv: tstl.SyntaxKind.FloorDivisionOperator,
  floorMod: tstl.SyntaxKind.ModuloOperator,
};

function integerOperator(node: ts.CallExpression, checker: ts.TypeChecker): tstl.BinaryOperator | undefined {
  if (!ts.isIdentifier(node.expression) || node.arguments.length !== 2) return undefined;
  const operator = integerOperators[node.expression.text];
  return operator !== undefined && declaredIn(node.expression, checker, "/src/sim/intMath.ts") ? operator : undefined;
}

/** f32(x) and Math.fround(x): binary32 rounding the Lua runtime already performs. */
function isRounding(node: ts.CallExpression, checker: ts.TypeChecker): boolean {
  if (node.arguments.length !== 1) return false;
  if (isMathMember(node.expression, "fround")) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === "f32" && declaredIn(node.expression, checker, "/src/sim/f32.ts");
}

/** `f32(0.1)` names the binary32 nearest 0.1, which Warcraft's parser also picks. */
function isRoundedLiteral(node: ts.NumericLiteral, checker: ts.TypeChecker): boolean {
  let outer: ts.Node = node;
  while (ts.isParenthesizedExpression(outer.parent) || (ts.isPrefixUnaryExpression(outer.parent) && outer.parent.operator === ts.SyntaxKind.MinusToken)) {
    outer = outer.parent;
  }
  return ts.isCallExpression(outer.parent) && isRounding(outer.parent, checker);
}

const RUNTIME_SERVICES = new Map([
  ["Date", "Date has no deterministic meaning in Warcraft; synchronized time is the frame counter"],
  ["JSON", "JSON isn't available in Warcraft's Lua"],
  ["Intl", "Intl isn't available in Warcraft's Lua"],
]);

/** Rejections walk the source, so they hold however TSTL lowers each construct. */
function check(file: ts.SourceFile, checker: ts.TypeChecker, diagnostics: ts.Diagnostic[]): void {
  // intMath holds the host definitions of the operations this plugin compiles to Lua operators.
  if (file.fileName.endsWith("/src/sim/intMath.ts")) return;
  const isTest = file.fileName.endsWith(".tests.ts");
  const reject = (node: ts.Node, messageText: string) =>
    diagnostics.push({ category: ts.DiagnosticCategory.Error, code: 9300, source: "warcraft", file, start: node.getStart(file), length: node.getWidth(file), messageText });
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node)) {
      const text = node.getText(file);
      const value = Number(node.text);
      if (/[.eE]/.test(text) && Math.fround(value) !== value && !isRoundedLiteral(node, checker)) {
        reject(node, `${text} isn't a binary32 value; write ${Math.fround(value)} or f32(${text})`);
      }
    } else if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.PercentToken || operator === ts.SyntaxKind.PercentEqualsToken) {
        reject(node.operatorToken, "`%` truncates in JavaScript and floors in Lua; use floorMod or imod");
      } else if (operator === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken || operator === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken) {
        reject(node.operatorToken, "`>>>` masks with 2^32 - 1, which 32-bit Lua can't hold; use floorDiv");
      }
    } else if (ts.isCallExpression(node)) {
      let argument = node.arguments[0];
      while (argument !== undefined && ts.isParenthesizedExpression(argument)) argument = argument.expression;
      if (isMathMember(node.expression, "floor") && argument !== undefined && ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.SlashToken) {
        reject(node, "Math.floor(a / b) divides in binary32 and loses bits above 2^24; use floorDiv or idiv");
      } else if (isMathMember(node.expression, "random")) {
        reject(node, "Math.random differs between clients; draw from the synchronized simulation instead");
      }
    } else if (ts.isIdentifier(node)) {
      const service = RUNTIME_SERVICES.get(node.text);
      if (service !== undefined && !ts.isTypeReferenceNode(node.parent) && isStandardLibrary(node, checker)) reject(node, service);
    } else if (!isTest) {
      if (ts.isNonNullExpression(node)) reject(node, "non-null `!` asserts what the code should check; handle the absent case");
      else if (node.kind === ts.SyntaxKind.AnyKeyword) reject(node, "`any` turns off type checking; name the type");
      else if (ts.isAsExpression(node) && ts.isAsExpression(node.expression) && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword) reject(node, "`as unknown as` forces an unrelated type; convert the value instead");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

const plugin: tstl.Plugin = {
  beforeTransform(program) {
    const diagnostics: ts.Diagnostic[] = [];
    for (const file of program.getSourceFiles()) {
      if (!file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file)) check(file, program.getTypeChecker(), diagnostics);
    }
    return diagnostics;
  },
  visitors: {
    [ts.SyntaxKind.NumericLiteral]: (node, context) => {
      const result = context.superTransformExpression(node);
      // Synthesized literals (for example from i++) have no source text.
      if (tstl.isNumericLiteral(result) && node.pos >= 0 && /[.eE]/.test(node.getText())) floatLiterals.add(result);
      return result;
    },
    [ts.SyntaxKind.CallExpression]: (node, context) => {
      if (isRounding(node, context.checker)) return context.transformExpression(node.arguments[0]!);
      const operator = integerOperator(node, context.checker);
      if (operator === undefined) return context.superTransformExpression(node);
      const [left, right] = node.arguments;
      return tstl.createBinaryExpression(context.transformExpression(left!), context.transformExpression(right!), operator, node);
    },
  },
  printer: (program, emitHost, fileName, file) => new WarcraftNumberPrinter(emitHost, program, fileName).print(file),
};

export default plugin;
