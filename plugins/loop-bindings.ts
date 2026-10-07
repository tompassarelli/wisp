// For-statement integration adapted from TypeScriptToLua 1.37.1's
// transformForStatement; upstream MIT notice is in plugins/TSTL-LICENSE.
import * as ts from "typescript";
import * as lua from "typescript-to-lua";
import { transformIdentifier } from "typescript-to-lua/dist/transformation/visitors/identifier";
import { transformLoopBody, invertCondition } from "typescript-to-lua/dist/transformation/visitors/loops/utils";
import { checkVariableDeclarationList, transformVariableDeclaration } from "typescript-to-lua/dist/transformation/visitors/variable-declaration";
import { transformInPrecedingStatementScope } from "typescript-to-lua/dist/transformation/utils/preceding-statements";
import { ScopeType } from "typescript-to-lua/dist/transformation/utils/scope";

const bindings = (name: ts.BindingName): ts.Identifier[] => ts.isIdentifier(name) ? [name] : name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : bindings(element.name));

function captures(statement: ts.ForStatement, names: readonly ts.Identifier[], checker: ts.TypeChecker): boolean {
  const symbols = new Set(names.map(name => checker.getSymbolAtLocation(name)).filter(symbol => symbol !== undefined));
  const visit = (node: ts.Node, depth: number): boolean => {
    if (depth > 0 && ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && symbols.has(symbol)) return true;
    }
    const nested = depth + (ts.isFunctionLike(node) ? 1 : 0);
    return ts.forEachChild(node, child => visit(child, nested) ? true : undefined) === true;
  };
  return visit(statement, 0);
}

/** ES per-iteration environments are copied before the update, not after it. */
export function transformForBindings(statement: ts.ForStatement, context: lua.TransformationContext): lua.Statement[] {
  const initializer = statement.initializer;
  if (initializer === undefined || !ts.isVariableDeclarationList(initializer) || !(initializer.flags & ts.NodeFlags.Let)) return context.superTransformStatements(statement);
  const names = initializer.declarations.flatMap(declaration => bindings(declaration.name));
  if (!captures(statement, names, context.checker)) return context.superTransformStatements(statement);

  context.pushScope(ScopeType.Loop, statement);
  checkVariableDeclarationList(context, initializer);
  const setup = initializer.declarations.flatMap(declaration => transformVariableDeclaration(context, declaration));
  const locals = names.map(name => transformIdentifier(context, name));
  const carried = locals.map(local => context.createTempNameForLuaExpression(local));
  const first = lua.createIdentifier(context.createTempName("firstIteration"));
  setup.push(lua.createVariableDeclarationStatement(carried, locals, statement), lua.createVariableDeclarationStatement(first, lua.createBooleanLiteral(true), statement));

  // Keep TSTL's existing loop scope, hoisting and continue labels.
  const body = transformLoopBody(context, statement);
  const expression = statement.condition;
  const condition = expression === undefined ? undefined : transformInPrecedingStatementScope(context, () => context.transformExpression(expression));
  const update = statement.incrementor === undefined ? [] : context.transformStatements(ts.factory.createExpressionStatement(statement.incrementor));
  const iteration: lua.Statement[] = [lua.createVariableDeclarationStatement(locals, carried, statement)];
  if (update.length > 0) iteration.push(lua.createIfStatement(lua.createUnaryExpression(first, lua.SyntaxKind.NotOperator), lua.createBlock(update), undefined, statement));
  iteration.push(lua.createAssignmentStatement(first, lua.createBooleanLiteral(false), statement));
  if (condition !== undefined) iteration.push(...condition.precedingStatements, lua.createIfStatement(invertCondition(condition.result), lua.createBlock([lua.createBreakStatement()]), undefined, statement.condition));
  iteration.push(...body, lua.createAssignmentStatement(carried, locals, statement));
  setup.push(lua.createWhileStatement(lua.createBlock(iteration), lua.createBooleanLiteral(true), statement));
  context.popScope();
  return [lua.createDoStatement(setup, statement)];
}
