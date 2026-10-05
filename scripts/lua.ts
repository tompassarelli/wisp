// Lua source text produced by host tools.

/** Long-string brackets that the text doesn't contain, so it can sit between them verbatim. */
export function longBrackets(text: string): [open: string, close: string] {
  let level = "";
  while (text.includes(`]${level}]`)) level += "=";
  return [`[${level}[`, `]${level}]`];
}
