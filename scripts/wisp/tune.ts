





import { readFileSync, writeFileSync } from "node:fs";
import { normalize, resolve } from "node:path";
import ts from "typescript";
import { Clock, Console, Context, Effect, Layer, Schema, Semaphore } from "effect";
import { describeCause } from "./command";
import { HotReload, type HotReloadFailure } from "./hotReload";
import { step } from "./timings";


export interface Tunable {

  readonly name: string;

  readonly group?: string;

  readonly file: string;






  readonly path: readonly string[];

  readonly kind: "f32" | "int";
  readonly min: number;
  readonly max: number;

  readonly step: number;
}

export class TuneFailure extends Schema.TaggedError<TuneFailure>()("TuneFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}


export interface Literal {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly value: number;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}


export function findLiteral(text: string, path: readonly string[]): Literal | string {
  const source = ts.createSourceFile("tunable.ts", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const [variable, ...keys] = path;
  let node: ts.Expression | undefined;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variable) node = declaration.initializer;
    }
  }
  if (node === undefined) return `no top-level variable ${variable} with a value`;
  for (const [index, key] of keys.entries()) {
    const object = unwrap(node);
    const at = path.slice(0, index + 1).join(".");
    if (!ts.isObjectLiteralExpression(object)) return `${at} is not an object literal`;
    const property = object.properties.find((candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === key);
    if (property === undefined) return `${at} has no property ${key}`;
    node = property.initializer;
  }
  let value = unwrap(node);
  const argument = ts.isCallExpression(value) && value.arguments.length === 1 ? value.arguments[0] : undefined;
  if (argument !== undefined) value = unwrap(argument);
  const negative = ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken;
  const literal = ts.isPrefixUnaryExpression(value) && negative ? value.operand : value;
  if (!ts.isNumericLiteral(literal)) return `${path.join(".")} is not a number literal or a call of one`;
  const start = value.getStart(source);
  const end = value.getEnd();
  return { start, end, text: text.slice(start, end), value: (negative ? -1 : 1) * Number(literal.text) };
}


export const runValue = (kind: Tunable["kind"], value: number) => (kind === "f32" ? Math.fround(value) : value);





export function literalText(kind: Tunable["kind"], value: number): string {
  if (kind === "int") return String(value);
  const text = String(Math.fround(value));
  return /[.eE]/.test(text) ? text : `${text}.0`;
}


export function checkValue(tunable: Tunable, value: number): number | string {
  if (!Number.isFinite(value)) return `${tunable.name}: ${value} is not a number`;
  if (value < tunable.min || value > tunable.max) return `${tunable.name}: ${value} is outside ${tunable.min} to ${tunable.max}`;
  if (tunable.kind === "int" && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) return `${tunable.name}: ${value} is not a 32-bit integer`;
  return runValue(tunable.kind, value);
}


export function replaceSpans(text: string, spans: readonly { readonly start: number; readonly end: number; readonly text: string }[]): string {
  let result = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) result = result.slice(0, span.start) + span.text + result.slice(span.end);
  return result;
}

const CONTEXT_LINES = 3;





export function lineDiff(file: string, before: string, after: string): string {
  const old = before.split("\n");
  const changed = after.split("\n");
  if (old.length !== changed.length) throw new Error("lineDiff takes texts with the same lines");
  const differing = old.flatMap((line, index) => (line === changed[index] ? [] : [index]));
  const hunks: { start: number; end: number }[] = [];
  for (const index of differing) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(old.length - (before.endsWith("\n") ? 2 : 1), index + CONTEXT_LINES);
    const last = hunks.at(-1);
    if (last !== undefined && start <= last.end + 1) last.end = end;
    else hunks.push({ start, end });
  }
  const lines = [`--- a/${file}`, `+++ b/${file}`];
  for (const { start, end } of hunks) {
    const count = end - start + 1;
    lines.push(`@@ -${start + 1},${count} +${start + 1},${count} @@`);
    for (let index = start; index <= end;) {
      if (old[index] === changed[index]) {
        lines.push(` ${old[index]}`);
        index++;
        continue;
      }
      let run = index;
      while (run <= end && old[run] !== changed[run]) run++;
      for (let line = index; line < run; line++) lines.push(`-${old[line]}`);
      for (let line = index; line < run; line++) lines.push(`+${changed[line]}`);
      index = run;
    }
  }
  return lines.join("\n");
}


export interface TunableState {
  readonly name: string;
  readonly group: string;
  readonly kind: Tunable["kind"];
  readonly min: number;
  readonly max: number;
  readonly step: number;

  readonly value: number;

  readonly original: number;

  readonly source: number | undefined;
}


export interface Applied {
  readonly version: number | undefined;
  readonly milliseconds: number;
}

export class Tune extends Context.Service<Tune, {
  readonly state: Effect.Effect<readonly TunableState[], TuneFailure>;

  readonly apply: (name: string, value: number) => Effect.Effect<Applied, TuneFailure | HotReloadFailure>;

  readonly keep: (name: string) => Effect.Effect<string, TuneFailure>;

  readonly reset: (name: string) => Effect.Effect<{ readonly diff: string; readonly applied: Applied }, TuneFailure | HotReloadFailure>;
}>()("wisp/Tune") {





  static readonly layer = (root: string, tunables: readonly Tunable[], replacements: Map<string, string>) => Layer.effect(Tune, Effect.gen(function*() {
    const reload = yield* HotReload;
    const read = (path: string) => Effect.try({ try: () => readFileSync(path, "utf8"), catch: (cause) => new TuneFailure({ problem: `can't read ${path}: ${describeCause(cause)}` }) });
    const write = (path: string, text: string) => Effect.try({ try: () => writeFileSync(path, text), catch: (cause) => new TuneFailure({ problem: `can't write ${path}: ${describeCause(cause)}` }) });
    const locate = (entry: Entry, text: string) => {
      const literal = findLiteral(text, entry.tunable.path);
      return typeof literal === "string" ? Effect.fail(new TuneFailure({ problem: `${entry.tunable.file}: ${literal}` })) : Effect.succeed(literal);
    };

    interface Entry {
      readonly tunable: Tunable;
      readonly path: string;
      readonly original: Literal;
      value: number;
    }
    const entries = new Map<string, Entry>();
    const problems: string[] = [];
    for (const tunable of tunables) {
      if (entries.has(tunable.name)) problems.push(`two tunables are named ${tunable.name}`);
      const path = normalize(resolve(root, tunable.file));
      const literal = findLiteral(yield* read(path), tunable.path);
      if (typeof literal === "string") problems.push(`${tunable.file}: ${literal}`);
      else entries.set(tunable.name, { tunable, path, original: literal, value: runValue(tunable.kind, literal.value) });
    }
    if (problems.length > 0) return yield* new TuneFailure({ problem: problems.join("\n") });
    const files = [...new Set([...entries.values()].map((entry) => entry.path))];
    const entry = (name: string) => {
      const found = entries.get(name);
      return found === undefined ? Effect.fail(new TuneFailure({ problem: `no tunable named ${name}` })) : Effect.succeed(found);
    };


    const replace = Effect.gen(function*() {
      for (const path of files) {
        const text = yield* read(path);
        const spans: { start: number; end: number; text: string }[] = [];
        for (const current of entries.values()) {
          if (current.path !== path) continue;
          const literal = yield* locate(current, text);
          if (runValue(current.tunable.kind, literal.value) !== current.value) spans.push({ start: literal.start, end: literal.end, text: literalText(current.tunable.kind, current.value) });
        }
        if (spans.length === 0) replacements.delete(path);
        else replacements.set(path, replaceSpans(text, spans));
      }
    });


    const run = (target: Entry, value: number) => Effect.gen(function*() {
      const started = yield* Clock.currentTimeMillis;
      if (value === target.value) return { version: undefined, milliseconds: 0 } satisfies Applied;
      const previous = target.value;
      target.value = value;
      const version = yield* Effect.andThen(replace, reload.publish).pipe(
        Effect.tapError(() => Effect.andThen(Effect.sync(() => {
          target.value = previous;
        }), Effect.ignore(replace))),
        step(`tune ${target.tunable.name} = ${literalText(target.tunable.kind, value)}`, { root: true }),
      );
      return { version, milliseconds: (yield* Clock.currentTimeMillis) - started } satisfies Applied;
    });


    const rewrite = (target: Entry, text: (literal: Literal) => string | undefined) => Effect.gen(function*() {
      const before = yield* read(target.path);
      const literal = yield* locate(target, before);
      const replacement = text(literal);
      if (replacement === undefined) return "";
      const after = replaceSpans(before, [{ start: literal.start, end: literal.end, text: replacement }]);
      yield* write(target.path, after);
      const diff = lineDiff(target.tunable.file, before, after);
      yield* Console.log(diff);
      yield* replace;
      return diff;
    });


    const lock = yield* Semaphore.make(1);
    const serial = <A, E>(effect: Effect.Effect<A, E>) => Semaphore.withPermit(lock, effect);

    return Tune.of({
      state: serial(Effect.forEach([...entries.values()], (current) => Effect.gen(function*() {
        const literal = findLiteral(yield* read(current.path), current.tunable.path);
        const { name, group = "", kind, min, max, step: increment } = current.tunable;
        return {
          name, group, kind, min, max, step: increment, value: current.value,
          original: runValue(kind, current.original.value),
          source: typeof literal === "string" ? undefined : runValue(kind, literal.value),
        } satisfies TunableState;
      }))),
      apply: (name, value) => serial(Effect.gen(function*() {
        const target = yield* entry(name);
        const checked = checkValue(target.tunable, value);
        if (typeof checked === "string") return yield* new TuneFailure({ problem: checked });
        return yield* run(target, checked);
      })),
      keep: (name) => serial(Effect.gen(function*() {
        const target = yield* entry(name);
        return yield* rewrite(target, (literal) =>
          runValue(target.tunable.kind, literal.value) === target.value ? undefined : literalText(target.tunable.kind, target.value));
      })),
      reset: (name) => serial(Effect.gen(function*() {
        const target = yield* entry(name);
        const diff = yield* rewrite(target, (literal) => (literal.text === target.original.text ? undefined : target.original.text));
        const applied = yield* run(target, runValue(target.tunable.kind, target.original.value));
        return { diff, applied };
      })),
    });
  }));
}
