


export function longBrackets(text: string): [open: string, close: string] {
  let level = "";
  while (text.includes(`]${level}]`)) level += "=";
  return [`[${level}[`, `]${level}]`];
}
