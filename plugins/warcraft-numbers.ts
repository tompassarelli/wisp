// Warcraft's Lua uses 32-bit integers that wrap silently and binary32 floats,
// so TypeScriptToLua's defaults would change results there. This plugin:
// - keeps literals written with a decimal point or exponent as Lua floats (1.0
//   would print as the integer 1, and `x * 2.0` could stay an integer and
//   overflow), matching Wurst's real literals;
// - compiles floorDiv and floorMod from src/sim/intMath.ts to Lua's exact
//   integer `//` and `%`;
// - compiles f32(a + b), f32(a - b) and f32(a * b) from src/sim/f32.ts to
//   f32(a, b, operation), which rounds the exact result to nearest: Warcraft's
//   raw + and * don't. A product with a power-of-two literal is exact and
//   stays raw;
// - compiles any other f32(x), and Math.fround(x), binary32 rounding on the
//   host, to x;
// - rejects code that would compile but compute differently in Warcraft, by
//   the number rules in wisp:plugins/number-rules.ts.
//
// It also records each `throw` statement's TypeScript file and line: Warcraft's
// Lua has no debug library, so a thrown value carries no position. Only the
// throwing branch runs the extra assignments.
import { dirname, relative } from "node:path";
import * as ts from "typescript";
import * as tstl from "typescript-to-lua";
import { LuaPrinter } from "typescript-to-lua";
import { F32_ADD, F32_MULTIPLY, F32_SUBTRACT } from "../src/sim/f32";
import { ROUNDING_HELPER_FILE, declarationsOf, isDeclaredIn, programNumberRules } from "./number-rules";

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

const integerOperators: Record<string, tstl.BinaryOperator> = {
  floorDiv: tstl.SyntaxKind.FloorDivisionOperator,
  floorMod: tstl.SyntaxKind.ModuloOperator,
};

function integerOperator(node: ts.CallExpression, program: ts.Program): tstl.BinaryOperator | undefined {
  if (!ts.isIdentifier(node.expression) || node.arguments.length !== 2) return undefined;
  const operator = integerOperators[node.expression.text];
  return operator !== undefined && isDeclaredIn(declarationsOf(ts, program, node.expression), "/src/sim/intMath.ts") ? operator : undefined;
}

const strip = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) ? strip(node.expression) : node);

/** A literal ±2^k: multiplying by it is exact under any rounding. */
function isPowerOfTwo(node: ts.Expression): boolean {
  let operand = strip(node);
  if (ts.isPrefixUnaryExpression(operand) && operand.operator === ts.SyntaxKind.MinusToken) operand = strip(operand.operand);
  if (!ts.isNumericLiteral(operand)) return false;
  const value = Number(operand.text);
  return value > 0 && 2 ** Math.round(Math.log2(value)) === value;
}

/** f32(a + b), f32(a - b) or f32(a * b): the operands and the code f32 takes for the operation in Lua. */
function roundedOperation(node: ts.CallExpression): { left: ts.Expression; right: ts.Expression; code: number } | undefined {
  const argument = node.arguments[0];
  if (!ts.isIdentifier(node.expression) || argument === undefined) return undefined;
  const operation = strip(argument);
  if (!ts.isBinaryExpression(operation)) return undefined;
  const { left, right } = operation;
  switch (operation.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return { left, right, code: F32_ADD };
    case ts.SyntaxKind.MinusToken:
      return { left, right, code: F32_SUBTRACT };
    case ts.SyntaxKind.AsteriskToken:
      return isPowerOfTwo(left) || isPowerOfTwo(right) ? undefined : { left, right, code: F32_MULTIPLY };
    default:
      return undefined;
  }
}

/** f32(x) and Math.fround(x): binary32 rounding the Lua runtime already performs. */
function isRounding(node: ts.CallExpression, program: ts.Program): boolean {
  if (node.arguments.length !== 1) return false;
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Math" && callee.name.text === "fround") return true;
  return ts.isIdentifier(callee) && callee.text === "f32" && isDeclaredIn(declarationsOf(ts, program, callee), ROUNDING_HELPER_FILE);
}

/** The throw's TypeScript file and line, relative to the project's tsconfig like mapped Lua positions. */
function throwSite(node: ts.ThrowStatement, options: tstl.CompilerOptions, sourcePrefix: string): string | undefined {
  if (node.pos < 0) return undefined;
  const file = node.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
  const project = typeof options.configFilePath === "string" ? dirname(options.configFilePath) : process.cwd();
  return `${sourcePrefix}${relative(project, file.fileName).replaceAll("\\", "/")}:${line + 1}`;
}

/**
 * `throw x` becomes `error(x, 0)` after naming x and its site in globals the
 * error reporter reads. A rethrow of the latest thrown value keeps its first site.
 */
function transformThrow(node: ts.ThrowStatement, context: tstl.TransformationContext, sourcePrefix: string): tstl.Statement[] {
  const site = throwSite(node, context.options, sourcePrefix);
  if (site === undefined) return context.superTransformStatements(node);
  const thrown = () => tstl.createIdentifier("____thrown");
  const global = (name: string) => tstl.createTableIndexExpression(tstl.createIdentifier("_G"), tstl.createStringLiteral(name));
  return [tstl.createDoStatement([
    tstl.createVariableDeclarationStatement(thrown(), context.transformExpression(node.expression), node),
    tstl.createIfStatement(
      tstl.createBinaryExpression(global("__wispThrown"), thrown(), tstl.SyntaxKind.InequalityOperator),
      tstl.createBlock([
        tstl.createAssignmentStatement(global("__wispThrown"), thrown(), node),
        tstl.createAssignmentStatement(global("__wispThrowSite"), tstl.createStringLiteral(site), node),
      ]),
      undefined,
      node,
    ),
    tstl.createExpressionStatement(tstl.createCallExpression(tstl.createIdentifier("error"), [thrown(), tstl.createNumericLiteral(0)]), node),
  ], node)];
}

/** `sourcePrefix` names a library's throw sites as its consumers import them, such as `wisp/`. */
const plugin = ({ sourcePrefix = "" }: { readonly sourcePrefix?: string }): tstl.Plugin => ({
  beforeTransform(program) {
    return program.getSourceFiles().flatMap((file) => programNumberRules(ts, program, file));
  },
  visitors: {
    [ts.SyntaxKind.NumericLiteral]: (node, context) => {
      const result = context.superTransformExpression(node);
      // Synthesized literals (for example from i++) have no source text.
      if (tstl.isNumericLiteral(result) && node.pos >= 0 && /[.eE]/.test(node.getText())) floatLiterals.add(result);
      return result;
    },
    [ts.SyntaxKind.CallExpression]: (node, context) => {
      if (isRounding(node, context.program)) {
        const rounded = roundedOperation(node);
        if (rounded === undefined) return context.transformExpression(node.arguments[0]!);
        const { left, right, code } = rounded;
        return tstl.createCallExpression(
          context.transformExpression(node.expression),
          [context.transformExpression(left), context.transformExpression(right), tstl.createNumericLiteral(code)],
          node,
        );
      }
      const operator = integerOperator(node, context.program);
      if (operator === undefined) return context.superTransformExpression(node);
      const [left, right] = node.arguments;
      return tstl.createBinaryExpression(context.transformExpression(left!), context.transformExpression(right!), operator, node);
    },
    [ts.SyntaxKind.ThrowStatement]: (node, context) => transformThrow(node, context, sourcePrefix),
  },
  printer: (program, emitHost, fileName, file) => new WarcraftNumberPrinter(emitHost, program, fileName).print(file),
});

export default plugin;
