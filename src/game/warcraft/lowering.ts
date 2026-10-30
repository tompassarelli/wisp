/**
 * A family's Warcraft lowering table: the Wisp export's name to the one native call it stands for.
 * A template is `Native(arg, ...)` where each arg is `$n` (the call's nth argument, 1-based, each at most once and in order)
 * or the literal `false`, `true` or an integer; wisp:plugins/game-api.ts substitutes the arguments in place.
 */
export type Lowering = Readonly<Record<string, string>>;

export interface Template {
  readonly native: string;
  readonly args: readonly ({ readonly arg: number } | { readonly literal: string })[];
}

export function parseTemplate(text: string): Template {
  const match = /^([A-Za-z0-9_]+)\((.*)\)$/.exec(text);
  if (match === null) throw new Error(`lowering template ${text} is not Native(args)`);
  const parts = (match[2] ?? "").trim() === "" ? [] : (match[2] ?? "").split(",").map(part => part.trim());
  let last = 0;
  const args = parts.map(part => {
    const position = /^\$([1-9][0-9]*)$/.exec(part);
    if (position !== null) {
      const arg = Number(position[1]);
      if (arg <= last) throw new Error(`lowering template ${text} reuses or reorders $${arg}`);
      last = arg;
      return { arg };
    }
    if (!/^(false|true|-?[0-9]+)$/.test(part)) throw new Error(`lowering template ${text} has an argument ${part} that is not $n or a literal`);
    return { literal: part };
  });
  return { native: match[1] ?? "", args };
}
