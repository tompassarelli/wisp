// Lowers Wisp's game API to the Warcraft natives it stands for (wisp:docs/game-api-plan.md): the import of
// wisp/game/<family> is dropped and each call of an imported function becomes the native call that the family's
// table in src/game/warcraft/<family>.ts names, with the arguments in place. The compiled map keeps no trace of the
// API, so a migrated call costs what the native call cost. Using an API function as a value is rejected, because
// under Lua no function exists to pass.
import { join } from "node:path";
import * as ts from "typescript";
import * as tstl from "typescript-to-lua";
import { transformArguments } from "typescript-to-lua/dist/transformation/visitors/call";
import { type Lowering, parseTemplate, type Template } from "../src/game/warcraft/lowering";

export const GAME_API_VALUE_CODE = 9310;

const GAME_DECLARATION = /[\\/]src[\\/]game[\\/]([a-z]+)\.d\.ts$/;
const tables = new Map<string, Map<string, Template>>();


function table(family: string): Map<string, Template> {
  let found = tables.get(family);
  if (found === undefined) {
    const module = require(join(import.meta.dir, "..", "src", "game", "warcraft", `${family}.ts`)) as Record<string, Lowering>;
    found = new Map(Object.entries(module[family] ?? {}).map(([name, text]) => [name, parseTemplate(text)]));
    tables.set(family, found);
  }
  return found;
}

function gameSymbol(node: ts.Node, checker: ts.TypeChecker): { readonly family: string; readonly name: string } | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const file = symbol?.declarations?.[0]?.getSourceFile().fileName;
  const family = file === undefined ? undefined : GAME_DECLARATION.exec(file)?.[1];
  return symbol === undefined || family === undefined ? undefined : { family, name: symbol.name };
}

const isGameImport = (node: ts.ImportDeclaration, checker: ts.TypeChecker): boolean => {
  const file = checker.getSymbolAtLocation(node.moduleSpecifier)?.declarations?.[0]?.getSourceFile().fileName;
  return file !== undefined && GAME_DECLARATION.test(file);
};

function valueUses(file: ts.SourceFile, checker: ts.TypeChecker): ts.Diagnostic[] {
  if (file.isDeclarationFile || !file.statements.some(statement => ts.isImportDeclaration(statement) && isGameImport(statement, checker))) return [];
  const found: ts.Diagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      const symbol = gameSymbol(node, checker);
      if (symbol !== undefined) found.push({
        file, start: node.getStart(file), length: node.getWidth(file), category: ts.DiagnosticCategory.Error, code: GAME_API_VALUE_CODE,
        messageText: `${symbol.name} from wisp/game/${symbol.family} is lowered at each call and has no value under Lua; call it directly.`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const plugin: tstl.Plugin = {
  beforeTransform(program) {
    const checker = program.getTypeChecker();
    return program.getSourceFiles().flatMap(file => valueUses(file, checker));
  },
  visitors: {
    [ts.SyntaxKind.ImportDeclaration]: (node, context) => isGameImport(node, context.checker) ? [] : context.superTransformStatements(node),
    [ts.SyntaxKind.CallExpression]: (node, context) => {
      const symbol = ts.isIdentifier(node.expression) ? gameSymbol(node.expression, context.checker) : undefined;
      if (symbol === undefined) return context.superTransformExpression(node);
      const template = table(symbol.family).get(symbol.name);
      if (template === undefined) throw new Error(`wisp/game/${symbol.family} declares ${symbol.name}, which src/game/warcraft/${symbol.family}.ts does not lower`);
      if (node.arguments.some(ts.isSpreadElement)) throw new Error(`${symbol.name} is lowered at its call and takes no spread arguments`);
      const given = transformArguments(context, node.arguments, context.checker.getResolvedSignature(node));
      const args = template.args.map(part => {
        if ("arg" in part) return given[part.arg - 1] ?? tstl.createNilLiteral();
        return part.literal === "true" ? tstl.createBooleanLiteral(true) : part.literal === "false" ? tstl.createBooleanLiteral(false) : tstl.createNumericLiteral(Number(part.literal));
      });
      return tstl.createCallExpression(tstl.createIdentifier(template.native, node.expression), args, node);
    },
  },
};

export default plugin;
