// Warcraft omits Lua's debug library. This opt-in compiler pass records active
// TypeScript frames; successful calls allocate no tables and protected calls
// retain the original thrown value. Generated helpers use Lua varargs so nils
// and multiple returns survive cleanup without packing every function result.
import { relative, resolve } from "node:path";
import * as ts from "typescript";
import * as lua from "typescript-to-lua";

const id = lua.createIdentifier;
const str = lua.createStringLiteral;
const num = lua.createNumericLiteral;
const get = (target: lua.Expression, key: string | lua.Expression) => lua.createTableIndexExpression(target, typeof key === "string" ? str(key) : key);
const state = () => id("____wispStack");
const field = (name: string) => get(state(), name);
const set = (left: lua.AssignmentLeftHandSideExpression, right: lua.Expression) => lua.createAssignmentStatement(left, right);
const call = (name: string, args: lua.Expression[]) => lua.createCallExpression(id(name), args);
const plus = (left: lua.Expression, right: lua.Expression) => lua.createBinaryExpression(left, right, lua.SyntaxKind.AdditionOperator);
const slot = () => plus(id("____wispBase"), num(1));
const reporters = new Set(["errors", "dispatch"].map((name) => resolve(import.meta.dir, `../src/platform/${name}.ts`)));

/** Shared across modules and hot reloads; frame strings are compiler constants. */
function prelude(): lua.Statement[] {
  const global = get(id("_G"), "__wispStack");
  const empty = lua.createTableExpression([
    lua.createTableFieldExpression(num(0), str("depth")),
    lua.createTableFieldExpression(lua.createTableExpression(), str("frames")),
  ]);
  const finish = lua.createFunctionExpression(lua.createBlock([
    set(field("depth"), id("base")),
    lua.createReturnStatement([lua.createDotsLiteral()]),
  ]), [id("base")], lua.createDotsLiteral());
  const failure = lua.createTableExpression([
    lua.createTableFieldExpression(id("thrown"), str("error")),
    lua.createTableFieldExpression(id("frames"), str("frames")),
    lua.createTableFieldExpression(field("depth"), str("depth")),
  ]);
  const protectedFinish = lua.createFunctionExpression(lua.createBlock([
    lua.createIfStatement(lua.createUnaryExpression(id("ok"), lua.SyntaxKind.NotOperator), lua.createBlock([
      lua.createVariableDeclarationStatement(id("thrown"), lua.createDotsLiteral()),
      lua.createIfStatement(lua.createBinaryExpression(
        lua.createUnaryExpression(field("failure"), lua.SyntaxKind.NotOperator),
        lua.createBinaryExpression(get(field("failure"), "error"), id("thrown"), lua.SyntaxKind.InequalityOperator),
        lua.SyntaxKind.OrOperator,
      ), lua.createBlock([
        lua.createVariableDeclarationStatement(id("frames"), lua.createTableExpression()),
        lua.createForStatement(lua.createBlock([
          set(get(id("frames"), id("i")), get(field("frames"), id("i"))),
        ]), id("i"), num(1), field("depth")),
        set(field("failure"), failure),
      ])),
    ])),
    set(field("depth"), id("base")),
    lua.createReturnStatement([id("ok"), lua.createDotsLiteral()]),
  ]), [id("base"), id("ok")], lua.createDotsLiteral());
  return [
    lua.createVariableDeclarationStatement(state(), lua.createBinaryExpression(global, empty, lua.SyntaxKind.OrOperator)),
    set(global, state()),
    lua.createVariableDeclarationStatement(id("____wispReturn"), finish),
    lua.createVariableDeclarationStatement(id("____wispProtectedReturn"), protectedFinish),
  ];
}

interface Frame { readonly name: string; readonly source: string; readonly line: number }
const positionKey = (node: lua.Node) => `${node.line}:${node.column}`;

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name !== undefined) return node.name.getText();
  if (ts.isConstructorDeclaration(node)) return `${node.parent.name?.getText() ?? "class"}.constructor`;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return parent.name.getText();
  if (ts.isCallExpression(parent)) {
    const event = parent.arguments[0];
    return `${parent.expression.getText()}${event !== undefined && ts.isStringLiteral(event) ? `(${JSON.stringify(event.text)})` : ""} callback`;
  }
  return "<anonymous>";
}

function functionFrames(file: ts.SourceFile, root: string): Map<string, Frame> {
  const frames = new Map<string, Frame>();
  const source = relative(root, file.fileName).replaceAll("\\", "/");
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && "body" in node && node.body !== undefined) {
      const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
      frames.set(`${line}:${character}`, { name: functionName(node), source, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return frames;
}

function isNode(value: unknown): value is lua.Node {
  return typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "number";
}

/** Visit only Lua AST children; maps and compiler metadata are not syntax. */
function children(node: lua.Node, visit: (child: lua.Node) => lua.Node): void {
  const record = node as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) record[key] = value.map((entry: unknown) => isNode(entry) ? visit(entry) : entry);
    else if (isNode(value)) record[key] = visit(value);
  }
}

function location(frame: Frame, line = frame.line): lua.Statement {
  return set(get(field("frames"), slot()), str(`${frame.source}:${line}: in ${frame.name}`));
}

function instrument(file: lua.File, frames: ReadonlyMap<string, Frame>): void {
  function visit(node: lua.Node, frame: Frame | undefined): lua.Node {
    if (lua.isFunctionExpression(node)) {
      const own = frames.get(positionKey(node));
      // TSTL's try/catch closures are implementation scopes, not source frames.
      children(node, (child) => visit(child, own));
      if (own !== undefined) {
        node.flags &= ~lua.NodeFlags.Inline;
        node.body.statements.unshift(
          lua.createVariableDeclarationStatement(id("____wispBase"), field("depth")),
          set(field("depth"), slot()),
          location(own),
        );
        const last = node.body.statements.at(-1);
        if (last === undefined || !lua.isReturnStatement(last)) {
          node.body.statements.push(set(field("depth"), id("____wispBase")));
        }
      }
      return node;
    }
    children(node, (child) => visit(child, frame));
    if (lua.isCallExpression(node) && lua.isIdentifier(node.expression) && ["pcall", "xpcall"].includes(node.expression.text)) {
      return lua.setNodePosition(call("____wispProtectedReturn", [field("depth"), node]), node);
    }
    if (frame !== undefined && lua.isReturnStatement(node)) {
      node.expressions = [call("____wispReturn", [id("____wispBase"), ...node.expressions])];
    }
    if (frame !== undefined && (lua.isBlock(node) || lua.isDoStatement(node))) {
      node.statements = node.statements.flatMap((statement) => {
        // These are source statement locations, including the throw itself.
        // Structural blocks retain their own children and locations.
        const line = statement.line ?? (lua.isExpressionStatement(statement) ? statement.expression.line : undefined);
        return line === undefined || lua.isLabelStatement(statement) ? [statement] : [location(frame, line + 1), statement];
      });
    }
    return node;
  }
  visit(file, undefined);
  file.statements.unshift(...prelude());
}

const plugin: lua.Plugin = {
  visitors: {
    [ts.SyntaxKind.SourceFile]: (node, context) => {
      const result = context.superTransformNode(node);
      // Reporting and the engine boundary must observe the failing frames
      // without adding their own reporter callbacks to the saved stack.
      const file = result.find(lua.isFile);
      if (file === undefined) throw new Error(`TypeScriptToLua did not emit a file for ${node.fileName}`);
      if (reporters.has(resolve(node.fileName))) return file;
      const root = resolve(context.options.rootDir ?? context.program.getCurrentDirectory());
      instrument(file, functionFrames(node, root));
      return file;
    },
  },
};

export default plugin;
