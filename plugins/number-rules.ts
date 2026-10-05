// Warcraft's number rules: code that compiles but computes differently in
// Warcraft's Lua, which has 32-bit integers that wrap and binary32 floats.
// The rules reject
// - decimal literals that aren't binary32 values, `%`, `>>>`, Math.floor(a / b),
//   and runtime services without a deterministic Lua meaning;
// - type escapes in game code (tests excepted): `any`, `as unknown as` and
//   non-null `!`, which assert what the code should check.
// Node, Bun and DOM APIs need no rule: the map tsconfig doesn't declare them.
//
// The compiler plugin (wisp:plugins/warcraft-numbers.ts), the editor plugin
// (wisp:plugins/number-rules-service.ts) and the check command
// (wisp:scripts/numberRules.ts) all run scanNumberRules. Each supplies its
// TypeScript's syntax module and says where an identifier is declared, so
// TypeScript 6's language service and TypeScript 7's API share these rules.
import type * as ts from "typescript";

/** The diagnostic code every number rule reports. */
export const NUMBER_RULE_CODE = 9300;

/** The syntax tree the rules read; TypeScript 6 and TypeScript 7 nodes both have it. */
export interface RuleNode<N> {
  readonly kind: number;
  readonly parent: N;
  getStart(): number;
  getText(): string;
  forEachChild<T>(visit: (node: N) => T): T | undefined;
}
interface Named { readonly text: string }

/** `typescript` (6) and `typescript-native/unstable/ast` (7) both provide this. */
export interface RuleSyntax<N extends RuleNode<N>> {
  readonly SyntaxKind: {
    readonly PercentToken: number;
    readonly PercentEqualsToken: number;
    readonly GreaterThanGreaterThanGreaterThanToken: number;
    readonly GreaterThanGreaterThanGreaterThanEqualsToken: number;
    readonly SlashToken: number;
    readonly MinusToken: number;
    readonly AnyKeyword: number;
    readonly UnknownKeyword: number;
  };
  isNumericLiteral(node: N): node is N & Named;
  isIdentifier(node: N): node is N & Named;
  isBinaryExpression(node: N): node is N & { readonly operatorToken: N };
  isCallExpression(node: N): node is N & { readonly expression: N; readonly arguments: readonly N[] };
  isParenthesizedExpression(node: N): node is N & { readonly expression: N };
  isPrefixUnaryExpression(node: N): node is N & { readonly operator: number };
  isPropertyAccessExpression(node: N): node is N & { readonly expression: N; readonly name: Named };
  isAsExpression(node: N): node is N & { readonly expression: N; readonly type: N };
  isNonNullExpression(node: N): boolean;
  isTypeReferenceNode(node: N): boolean;
}

/** Where an identifier's symbol (after following imports) is declared. */
export interface Declaration {
  readonly fileName: string;
  readonly isDefaultLibrary: boolean;
}

/**
 * What a finding needs to know about one identifier:
 * - "standardLibrary": the finding stands if the identifier is TypeScript's own global;
 * - "notRoundingHelper": the finding stands unless the identifier is Wisp's f32().
 */
export type DeclarationTest = "standardLibrary" | "notRoundingHelper";

export interface Finding<N> {
  readonly node: N;
  readonly message: string;
  readonly condition?: { readonly identifier: N; readonly test: DeclarationTest };
}

export const ROUNDING_HELPER_FILE = "/src/sim/f32.ts";

/** Whether the first declaration is the helper in a file ending with `fileSuffix`. */
export function isDeclaredIn(declarations: readonly Declaration[], fileSuffix: string): boolean {
  const file = declarations[0]?.fileName;
  // Installed TSTL libraries expose generated declarations for their Lua
  // modules; both declarations and source name the same helper identity.
  return file !== undefined && (file.endsWith(fileSuffix) || file.endsWith(fileSuffix.replace(/\.ts$/, ".d.ts")));
}

/** Whether a conditional finding stands, given its identifier's declarations. */
export function stands(test: DeclarationTest, declarations: readonly Declaration[]): boolean {
  return test === "standardLibrary"
    ? declarations.some((declaration) => declaration.isDefaultLibrary)
    : !isDeclaredIn(declarations, ROUNDING_HELPER_FILE);
}

const RUNTIME_SERVICES = new Map([
  ["Date", "Date has no deterministic meaning in Warcraft; synchronized time is the frame counter"],
  ["JSON", "JSON isn't available in Warcraft's Lua"],
  ["Intl", "Intl isn't available in Warcraft's Lua"],
]);

/** Every number-rule finding in one file. Conditional findings still need their identifier resolved. */
export function scanNumberRules<N extends RuleNode<N>>(syntax: RuleSyntax<N>, file: N & { readonly fileName: string }): Finding<N>[] {
  // intMath holds the host definitions of the operations the compiler turns into Lua operators.
  if (file.fileName.endsWith("/src/sim/intMath.ts")) return [];
  const { SyntaxKind: kind } = syntax;
  // Matched structurally: calls TSTL synthesizes, as for optional chains, have no source text.
  const isMathMember = (node: N, member: string) =>
    syntax.isPropertyAccessExpression(node) && syntax.isIdentifier(node.expression) && node.expression.text === "Math" && node.name.text === member;
  const isTest = file.fileName.endsWith(".tests.ts");
  const findings: Finding<N>[] = [];
  const reject = (node: N, message: string) => findings.push({ node, message });
  const visit = (node: N): void => {
    if (syntax.isNumericLiteral(node)) {
      const text = node.getText();
      const value = Number(node.text);
      if (/[.eE]/.test(text) && Math.fround(value) !== value) {
        // `f32(0.1)` names the binary32 nearest 0.1, which Warcraft's parser also picks.
        let outer: N = node;
        while (syntax.isParenthesizedExpression(outer.parent) || (syntax.isPrefixUnaryExpression(outer.parent) && outer.parent.operator === kind.MinusToken)) {
          outer = outer.parent;
        }
        const call = outer.parent;
        const message = `${text} isn't a binary32 value; write ${Math.fround(value)} or f32(${text})`;
        if (!syntax.isCallExpression(call) || call.arguments.length !== 1) reject(node, message);
        else if (syntax.isIdentifier(call.expression) && call.expression.text === "f32") {
          findings.push({ node, message, condition: { identifier: call.expression, test: "notRoundingHelper" } });
        } else if (!isMathMember(call.expression, "fround")) reject(node, message);
      }
    } else if (syntax.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === kind.PercentToken || operator === kind.PercentEqualsToken) {
        reject(node.operatorToken, "`%` truncates in JavaScript and floors in Lua; use floorMod or imod");
      } else if (operator === kind.GreaterThanGreaterThanGreaterThanToken || operator === kind.GreaterThanGreaterThanGreaterThanEqualsToken) {
        reject(node.operatorToken, "`>>>` masks with 2^32 - 1, which 32-bit Lua can't hold; use floorDiv");
      }
    } else if (syntax.isCallExpression(node)) {
      let argument = node.arguments[0];
      while (argument !== undefined && syntax.isParenthesizedExpression(argument)) argument = argument.expression;
      if (isMathMember(node.expression, "floor") && argument !== undefined && syntax.isBinaryExpression(argument) && argument.operatorToken.kind === kind.SlashToken) {
        reject(node, "Math.floor(a / b) divides in binary32 and loses bits above 2^24; use floorDiv or idiv");
      } else if (isMathMember(node.expression, "random")) {
        reject(node, "Math.random differs between clients; draw from the synchronized simulation instead");
      }
    } else if (syntax.isIdentifier(node)) {
      const service = RUNTIME_SERVICES.get(node.text);
      if (service !== undefined && !syntax.isTypeReferenceNode(node.parent)) {
        findings.push({ node, message: service, condition: { identifier: node, test: "standardLibrary" } });
      }
    } else if (!isTest) {
      if (syntax.isNonNullExpression(node)) reject(node, "non-null `!` asserts what the code should check; handle the absent case");
      else if (node.kind === kind.AnyKeyword) reject(node, "`any` turns off type checking; name the type");
      else if (syntax.isAsExpression(node) && syntax.isAsExpression(node.expression) && node.expression.type.kind === kind.UnknownKeyword) reject(node, "`as unknown as` forces an unrelated type; convert the value instead");
    }
    node.forEachChild(visit);
  };
  visit(file);
  return findings;
}

/** The declarations of an identifier's symbol in a TypeScript 6 program, following imports. */
export function declarationsOf(typescript: typeof ts, program: ts.Program, node: ts.Node): Declaration[] {
  const checker = program.getTypeChecker();
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && symbol.flags & typescript.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return (symbol?.declarations ?? []).map((declaration) => {
    const file = declaration.getSourceFile();
    return { fileName: file.fileName, isDefaultLibrary: program.isSourceFileDefaultLibrary(file) };
  });
}

/** The number-rule diagnostics of one file of a TypeScript 6 program (compiler and editor). */
export function programNumberRules(typescript: typeof ts, program: ts.Program, file: ts.SourceFile): ts.Diagnostic[] {
  if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file)) return [];
  // Binding sets the parent links the rules follow.
  program.getTypeChecker();
  const diagnostics: ts.Diagnostic[] = [];
  for (const { node, message, condition } of scanNumberRules<ts.Node>(typescript, file)) {
    if (condition !== undefined && !stands(condition.test, declarationsOf(typescript, program, condition.identifier))) continue;
    diagnostics.push({
      category: typescript.DiagnosticCategory.Error,
      code: NUMBER_RULE_CODE,
      source: "warcraft",
      file,
      start: node.getStart(file),
      length: node.getWidth(file),
      messageText: message,
    });
  }
  return diagnostics;
}
