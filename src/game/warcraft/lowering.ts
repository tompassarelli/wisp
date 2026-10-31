/**
 * A family's Warcraft lowering table: the Wisp export's name to the one expression it stands for.
 * A template is `Native(arg, ...)` where each arg is `$n` (the call's nth argument, 1-based, each at most once and in order),
 * the literal `false`, `true` or an integer, a global such as `EVENT_PLAYER_LEAVE`, or a nested `Native(arg, ...)`;
 * wisp:plugins/game-api.ts substitutes the arguments in place.
 */
export type Lowering = Readonly<Record<string, string>>;

export type TemplateArgument =
  | { readonly arg: number }
  | { readonly literal: string }
  | { readonly global: string }
  | { readonly call: Template };

export interface Template {
  readonly native: string;
  readonly args: readonly TemplateArgument[];
}

const TOKEN = /\s*([A-Za-z_][A-Za-z0-9_]*|\$[1-9][0-9]*|-?[0-9]+|[(),])/y;

export function parseTemplate(text: string): Template {
  let position = 0;
  let last = 0;
  const fail = (problem: string): Error => new Error(`lowering template ${text} ${problem}`);
  const peek = (): string | undefined => {
    TOKEN.lastIndex = position;
    return TOKEN.exec(text)?.[1];
  };
  const next = (): string => {
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(text);
    if (match === null) throw fail(`is not Native(args) at ${position}`);
    position = TOKEN.lastIndex;
    return match[1] ?? "";
  };
  const expect = (token: string): void => {
    if (next() !== token) throw fail(`expects ${token}`);
  };
  const argument = (): TemplateArgument => {
    const token = next();
    if (token.startsWith("$")) {
      const arg = Number(token.slice(1));
      if (arg <= last) throw fail(`reuses or reorders $${arg}`);
      last = arg;
      return { arg };
    }
    if (/^(false|true|-?[0-9]+)$/.test(token)) return { literal: token };
    if (peek() === "(") return { call: call(token) };
    if (/^[A-Z][A-Z0-9_]*$/.test(token)) return { global: token };
    throw fail(`has an argument ${token} that is not $n, a literal, a global or a call`);
  };
  const call = (native: string): Template => {
    if (!/^[A-Za-z0-9_]+$/.test(native)) throw fail(`names ${native}, which is not a native`);
    expect("(");
    const args: TemplateArgument[] = [];
    if (peek() === ")") next();
    else {
      for (;;) {
        args.push(argument());
        const separator = next();
        if (separator === ")") break;
        if (separator !== ",") throw fail(`expects , or ) after an argument`);
      }
    }
    return { native, args };
  };
  const template = call(next());
  if (peek() !== undefined) throw fail("has text after the call");
  return template;
}

/** Every native a template calls, outer first, with the globals it reads. */
export function templateParts(template: Template): { readonly calls: readonly Template[]; readonly globals: readonly string[]; readonly arguments: number } {
  const calls: Template[] = [template];
  const globals: string[] = [];
  let count = 0;
  for (const part of template.args) {
    if ("arg" in part) count++;
    else if ("global" in part) globals.push(part.global);
    else if ("call" in part) {
      const inner = templateParts(part.call);
      calls.push(...inner.calls);
      globals.push(...inner.globals);
      count += inner.arguments;
    }
  }
  return { calls, globals, arguments: count };
}
