// The natives a headless client stubs, read from the generated declarations
// (wisp:src/natives/warcraft.d.ts): each function with its return type, and
// each constant and global variable with its type. Plain string operations, so
// Bun and 32-bit Lua read the same file alike.

export interface NativeDeclarations {
  readonly functions: readonly (readonly [name: string, returns: string])[];
  readonly constants: readonly (readonly [name: string, type: string])[];
  /** Global variables, such as `bj_mapInitialPlayableArea`; an array type ends with `[]`. */
  readonly variables: readonly (readonly [name: string, type: string])[];
}

/** `declare KEYWORD NAME...`: the name, up to the first character that can't be in one. */
function declaredName(line: string, keyword: string): string | undefined {
  const start = keyword.length;
  let end = start;
  while (end < line.length) {
    const character = line.charAt(end);
    if (character === "(" || character === ":" || character === " ") break;
    end++;
  }
  return end > start ? line.slice(start, end) : undefined;
}

/** The type after the last `: ` and before the closing `;`. */
function declaredType(line: string): string | undefined {
  if (!line.endsWith(";")) return undefined;
  for (let colon = line.length - 2; colon > 0; colon--) {
    if (line.charAt(colon) === ":" && line.charAt(colon + 1) === " ") return line.slice(colon + 2, line.length - 1);
  }
  return undefined;
}

export function parseNativeDeclarations(text: string): NativeDeclarations {
  const functions: (readonly [string, string])[] = [];
  const constants: (readonly [string, string])[] = [];
  const variables: (readonly [string, string])[] = [];
  for (const line of text.split("\n")) {
    const keyword = line.startsWith("declare function ") ? "declare function "
      : line.startsWith("declare const ") ? "declare const "
        : line.startsWith("declare let ") ? "declare let " : undefined;
    if (keyword === undefined) continue;
    const name = declaredName(line, keyword);
    const type = declaredType(line.trim());
    if (name === undefined || type === undefined) continue;
    if (keyword === "declare function ") functions.push([name, type]);
    else if (keyword === "declare const ") constants.push([name, type]);
    else variables.push([name, type]);
  }
  return { functions, constants, variables };
}
