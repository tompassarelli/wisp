// Lowers Wisp's game API to the Warcraft natives it stands for (wisp:docs/game-api-plan.md): the import of
// wisp/game/<family> is dropped and each call of an imported function becomes the native call that the family's
// table in src/game/warcraft/<family>.ts names, with the arguments in place. The compiled map keeps no trace of the
// API, so a migrated call costs what the native call cost. A family constant (EffectAnimation.attack) becomes a read
// of the global the family's <family>Constants table names. Using an API function as a value is rejected, because
// under Lua no function exists to pass.
import * as ts from "typescript";
import * as tstl from "typescript-to-lua";
import { transformArguments } from "typescript-to-lua/dist/transformation/visitors/call";
import { type ConstantLowering, type Lowering, parseTemplate, type Template, type TemplateArgument } from "../src/game/warcraft/lowering";
import * as bodies from "../src/game/warcraft/bodies";
import * as clock from "../src/game/warcraft/clock";
import * as effects from "../src/game/warcraft/effects";
import * as events from "../src/game/warcraft/events";
import * as files from "../src/game/warcraft/files";
import * as frames from "../src/game/warcraft/frames";
import * as input from "../src/game/warcraft/input";
import * as players from "../src/game/warcraft/players";
import * as sound from "../src/game/warcraft/sound";
import * as sync from "../src/game/warcraft/sync";
import * as text from "../src/game/warcraft/text";
import * as view from "../src/game/warcraft/view";

export const GAME_API_VALUE_CODE = 9310;

const GAME_DECLARATION = /[\\/]src[\\/]game[\\/]([a-z]+)\.d\.ts$/;
const modules: Readonly<Record<string, Readonly<Record<string, Lowering | ConstantLowering>>>> = { bodies, clock, effects, events, files, frames, input, players, sound, sync, text, view };
const tables = new Map<string, Map<string, Template>>();
const constantTables = new Map<string, ConstantLowering>();

function constants(family: string): ConstantLowering {
  let found = constantTables.get(family);
  if (found === undefined) {
    const module = modules[family] as Record<string, ConstantLowering> | undefined;
    found = module?.[`${family}Constants`] ?? {};
    constantTables.set(family, found);
  }
  return found;
}


function table(family: string): Map<string, Template> {
  let found = tables.get(family);
  if (found === undefined) {
    const module = modules[family] as Record<string, Lowering> | undefined;
    found = new Map(Object.entries(module?.[family] ?? {}).map(([name, template]) => [name, parseTemplate(template)]));
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

function constantGlobal(node: ts.Node, checker: ts.TypeChecker): string | undefined {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  const symbol = gameSymbol(node.expression, checker);
  if (symbol === undefined) return undefined;
  const global = constants(symbol.family)[symbol.name]?.[node.name.text];
  if (global === undefined) throw new Error(`wisp/game/${symbol.family} declares ${symbol.name}.${node.name.text}, which src/game/warcraft/${symbol.family}.ts does not lower`);
  return global;
}

const isGameImport = (node: ts.ImportDeclaration, checker: ts.TypeChecker): boolean => {
  const file = checker.getSymbolAtLocation(node.moduleSpecifier)?.declarations?.[0]?.getSourceFile().fileName;
  return file !== undefined && GAME_DECLARATION.test(file);
};

const isConstantAccess = (node: ts.Identifier, checker: ts.TypeChecker): boolean =>
  ts.isPropertyAccessExpression(node.parent) && constantGlobal(node.parent, checker) !== undefined;

function valueUses(file: ts.SourceFile, checker: ts.TypeChecker): ts.Diagnostic[] {
  if (file.isDeclarationFile || !file.statements.some(statement => ts.isImportDeclaration(statement) && isGameImport(statement, checker))) return [];
  const found: ts.Diagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node) && !ts.isTypeReferenceNode(node.parent) && !isConstantAccess(node, checker)) {
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
    [ts.SyntaxKind.PropertyAccessExpression]: (node, context) => {
      const global = constantGlobal(node, context.checker);
      return global === undefined ? context.superTransformExpression(node) : tstl.createIdentifier(global, node);
    },
    [ts.SyntaxKind.CallExpression]: (node, context) => {
      const symbol = ts.isIdentifier(node.expression) ? gameSymbol(node.expression, context.checker) : undefined;
      if (symbol === undefined) return context.superTransformExpression(node);
      const template = table(symbol.family).get(symbol.name);
      if (template === undefined) throw new Error(`wisp/game/${symbol.family} declares ${symbol.name}, which src/game/warcraft/${symbol.family}.ts does not lower`);
      if (node.arguments.some(ts.isSpreadElement)) throw new Error(`${symbol.name} is lowered at its call and takes no spread arguments`);
      const given = transformArguments(context, node.arguments, context.checker.getResolvedSignature(node));
      const lower = (part: Template, at: ts.Node): tstl.CallExpression => tstl.createCallExpression(tstl.createIdentifier(part.native, at), part.args.map(argument), at);
      const argument = (part: TemplateArgument): tstl.Expression => {
        if ("arg" in part) return given[part.arg - 1] ?? tstl.createNilLiteral();
        if ("global" in part) return tstl.createIdentifier(part.global, node.expression);
        if ("call" in part) return lower(part.call, node.expression);
        return part.literal === "true" ? tstl.createBooleanLiteral(true) : part.literal === "false" ? tstl.createBooleanLiteral(false) : tstl.createNumericLiteral(Number(part.literal));
      };
      return lower(template, node);
    },
  },
};

export default plugin;
