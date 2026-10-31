/** A frame in an FDF file: its type, name, what it inherits, its fields in order and the frames it holds. */
export interface FdfFrame {
  readonly type: string;
  readonly name: string;
  readonly inherits: string | undefined;
  readonly withChildren: boolean;
  readonly fields: ReadonlyMap<string, readonly string[]>;
  readonly children: readonly FdfFrame[];
}

export interface FdfFile {
  readonly includes: readonly string[];
  readonly frames: readonly FdfFrame[];
}

const TOKEN = /\/\/[^\n]*|"((?:[^"\\]|\\.)*)"|([{},])|([^\s{},"]+)/g;

function tokens(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    if (match[1] !== undefined) found.push(`"${match[1]}`);
    else if (match[2] !== undefined) found.push(match[2]);
    else if (match[3] !== undefined) found.push(match[3]);
  }
  return found;
}

const value = (token: string) => (token.startsWith("\"") ? token.slice(1) : token);

/** Reads the frame definition format Warcraft's UI files and maps share: `Frame "TYPE" "Name" [INHERITS [WITHCHILDREN] "Base"] { Field values, ... }`. */
export function parseFdf(text: string): FdfFile {
  const list = tokens(text);
  let at = 0;
  const includes: string[] = [];
  const statement = (): string[] => {
    const words: string[] = [];
    while (at < list.length && list[at] !== "," && list[at] !== "}") {
      if (list[at] === "{") {
        skipBlock();
        return words;
      }
      words.push(value(list[at++] ?? ""));
    }
    if (list[at] === ",") at++;
    return words;
  };
  const skipBlock = () => {
    let depth = 0;
    do {
      if (list[at] === "{") depth++;
      else if (list[at] === "}") depth--;
      at++;
    } while (depth > 0 && at < list.length);
  };
  const frame = (): FdfFrame => {
    at++;
    const type = value(list[at++] ?? "");
    const name = value(list[at++] ?? "");
    let inherits: string | undefined;
    let withChildren = false;
    if (list[at] === "INHERITS") {
      at++;
      if (list[at] === "WITHCHILDREN") {
        withChildren = true;
        at++;
      }
      inherits = value(list[at++] ?? "");
    }
    const fields = new Map<string, string[]>();
    const children: FdfFrame[] = [];
    if (list[at] === "{") {
      at++;
      while (at < list.length && list[at] !== "}") {
        if (list[at] === "Frame") children.push(frame());
        else {
          const [key, ...values] = statement();
          if (key !== undefined) fields.set(key, values);
        }
      }
      at++;
    }
    return { type, name, inherits, withChildren, fields, children };
  };
  const frames: FdfFrame[] = [];
  while (at < list.length) {
    if (list[at] === "Frame") frames.push(frame());
    else if (list[at] === "IncludeFile") {
      at++;
      includes.push(value(list[at++] ?? ""));
      if (list[at] === ",") at++;
    } else {
      const before = at;
      statement();
      if (at === before) at++;
    }
  }
  return { includes, frames };
}

/** The `[section]` keys of a Warcraft ini-style text file such as `UI\war3skins.txt`. */
export function parseSections(text: string): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      current = sections.get(header[1] ?? "") ?? new Map();
      sections.set(header[1] ?? "", current);
      continue;
    }
    const equals = line.indexOf("=");
    if (equals > 0) current.set(line.slice(0, equals), line.slice(equals + 1));
  }
  return sections;
}
