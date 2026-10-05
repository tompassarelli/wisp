// The typed boundary between Wisp and the game: every file either side
// writes into CustomMapData for the other. Names and line formats come from
// wisp:src/runtime/gameFiles.ts, which map code shares.
//
// The game writes Warcraft Preload files: a JASS function whose
// `call Preload( "LINE" )` statements carry the text, with CRLF and tab
// whitespace around them. Each kind decodes here into a record, or fails with
// MalformedGameFile naming the file and the field.
import { join } from "node:path";
import { Effect, Schema, SchemaIssue } from "effect";
import { FILE_IO_ABILITY, FILE_SLOTS } from "../../src/runtime/gameFiles";
import { longBrackets } from "../lua";

export class MalformedGameFile extends Schema.TaggedError<MalformedGameFile>()("MalformedGameFile", {
  file: Schema.String,
  field: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.file}: ${this.field}: ${this.problem}`;
  }
}

/** A kind of file the game writes, decoded into `A`. */
export interface GameFileKind<A> {
  readonly decode: (file: string, text: string) => Effect.Effect<A, MalformedGameFile>;
}

const PRELOAD_HEADER = /^function PreloadFiles takes nothing returns nothing\r?\n/;
const PRELOAD_LINE = /^\s*call Preload\( "(.*)" \)[\t ]*\r?$/gm;

/** The lines a complete Preload file stores, or undefined when it is not one (or not yet whole). */
function preloadLines(text: string): string[] | undefined {
  if (!PRELOAD_HEADER.test(text) || !text.trimEnd().endsWith("endfunction")) return undefined;
  return [...text.matchAll(PRELOAD_LINE)].map((match) => match[1] ?? "");
}

const FIELD = /^\{(\w+)\}$/;

/**
 * Fields of a line shaped like `template`, where `{name}` words are fields and
 * other words must appear as written; the last field takes the rest of the
 * line. A line that ends early leaves its remaining fields out, for the schema
 * to report as missing; undefined when a written word differs.
 */
function lineFields(template: string, line: string): Record<string, string> | undefined {
  const parts = template.split(" ");
  const words = line.split(" ");
  const fields: Record<string, string> = {};
  let cursor = 0;
  for (const [index, part] of parts.entries()) {
    if (cursor >= words.length) break;
    const assignment = /^([\w.-]+)=\{(\w+)\}$/.exec(part);
    const name = assignment?.[2] ?? FIELD.exec(part)?.[1];
    if (name === undefined) {
      if (words[cursor] !== part) return undefined;
      cursor++;
      continue;
    }
    const next = parts[index + 1];
    const nextKey = next === undefined ? undefined : /^([\w.-]+)=\{\w+\}$/.exec(next)?.[1];
    // A text assignment may contain spaces (e.g. a failure reason), delimited
    // by the following key. The last field takes the remaining text.
    const nextCursor = index === parts.length - 1 ? words.length : nextKey === undefined ? cursor + 1
      : words.findIndex((word, position) => position > cursor && word.startsWith(`${nextKey}=`));
    const end = nextCursor < 0 ? words.length : nextCursor;
    const word = words.slice(cursor, end).join(" ");
    if (assignment !== null && !word.startsWith(`${assignment[1]}=`)) return undefined;
    const value = assignment === null ? word : word.slice(assignment[1]!.length + 1);
    if (value !== undefined && value !== "") fields[name] = value;
    cursor = end;
  }
  return fields;
}

/** Where a record's fields sit among a Preload file's lines. */
export interface Layout {
  /** Templates of the first lines, in order. */
  readonly head?: readonly string[];
  /** The array field that takes the lines between head and tail. */
  readonly rest?: string;
  /** Templates of the last lines, in order. */
  readonly tail?: readonly string[];
}

/** A Preload file whose lines follow `layout`, decoded by `schema`. */
export function preloadRecord<S extends Schema.Top & { readonly DecodingServices: never }>(
  { head = [], rest, tail = [] }: Layout,
  schema: S,
): GameFileKind<S["Type"]> {
  return {
    decode: (file, text) => Effect.gen(function*() {
      const malformed = (field: string, problem: string) => new MalformedGameFile({ file, field, problem });
      const lines = preloadLines(text);
      if (lines === undefined) return yield* malformed("PreloadFiles", "not a complete Preload file");
      const tailStart = Math.max(head.length, lines.length - tail.length);
      const placed = [...head.map((template, index) => [index, template] as const), ...tail.map((template, index) => [tailStart + index, template] as const)];
      const fields: Record<string, unknown> = {};
      for (const [index, template] of placed) {
        const line = lines[index];
        if (line === undefined) return yield* malformed(`line ${index + 1}`, `missing; expected "${template}"`);
        const found = lineFields(template, line);
        if (found === undefined) return yield* malformed(`line ${index + 1}`, `expected "${template}", found "${line}"`);
        Object.assign(fields, found);
      }
      if (rest !== undefined) fields[rest] = lines.slice(head.length, tailStart);
      return yield* Schema.decodeUnknownEffect(schema)(fields).pipe(Effect.mapError((error) => {
        const issue = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues[0];
        return malformed(issue?.path === undefined || issue.path.length === 0 ? "record" : issue.path.join("."), issue?.message ?? error.message);
      }));
    }),
  };
}

export const Count = Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const Seconds = Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0));

/** A client acknowledgement: the hot-reload version this client installed. */
export const Acknowledgement = preloadRecord(
  { head: ["applied {version} at {elapsed}"] },
  Schema.Struct({ version: Count, elapsed: Seconds }),
);

/** A client error report: a runtime error in an engine callback, its message and stack lines. */
export const ErrorReport = preloadRecord(
  { head: ["error {count} in {handler}"], rest: "lines" },
  Schema.Struct({ count: Count.check(Schema.isGreaterThanOrEqualTo(1)), handler: Schema.NonEmptyString, lines: Schema.Array(Schema.String) }),
);

/** The slots whose per-slot files a client may write. */
export const FILE_SLOT_NUMBERS: readonly number[] = Array.from({ length: FILE_SLOTS }, (_, slot) => slot);

// ---------------------------------------------------------------- files Wisp writes

/** A Preload file whose execution stores one short line in the FileIO tooltip. */
export function linePreloadFile(line: string): string {
  return `function PreloadFiles takes nothing returns nothing\ncall BlzSetAbilityTooltip('$wsl', "${line}", 0)\nendfunction\n`;
}

/**
 * A Preload file of raw Lua (Warcraft passes a usercode block through) that
 * stores the bytes verbatim in one tooltip, with no encoding to undo in game.
 */
export function payloadPreloadFile(bytes: Uint8Array): Uint8Array {
  const [open, close] = longBrackets(new TextDecoder().decode(bytes));
  const encoder = new TextEncoder();
  // Lua drops the newline right after an opening long bracket.
  const head = encoder.encode(`//!beginusercode\nBlzSetAbilityTooltip(${FILE_IO_ABILITY}, ${open}\n`);
  const tail = encoder.encode(`${close}, 0)\n//!endusercode\n`);
  const file = new Uint8Array(head.length + bytes.length + tail.length);
  file.set(head);
  file.set(bytes, head.length);
  file.set(tail, head.length + bytes.length);
  return file;
}

/**
 * checksum() (wisp:src/runtime/payload.ts) of these bytes, computed inline:
 * both lanes stay below 2^31, where JavaScript's % is the floorMod it uses.
 */
export function bytesChecksum(bytes: Uint8Array): string {
  let first = 0;
  let second = 0;
  for (const byte of bytes) {
    first = (first * 257 + byte + 1) % 8165329;
    second = (second * 263 + byte + 1) % 8165323;
  }
  return `${first}:${second}`;
}

/** Where a game path relative to CustomMapData (wisp:src/runtime/gameFiles.ts) is on the host. */
export const hostPath = (directory: string, gamePath: string) => join(directory, ...gamePath.split("\\"));

/** The version a manifest file name in the hot folder carries; undefined for other names. */
export function manifestVersion(name: string): number | undefined {
  const version = /^manifest-(\d+)\.pld$/.exec(name)?.[1];
  return version === undefined ? undefined : Number(version);
}

/** The payload key a payload file name in the hot folder carries, a full payload's or a delta's; undefined for other names. */
export function payloadFileKey(name: string): string | undefined {
  return /^(\d+-\d+(?:-\d+-\d+)?)-\d+\.pld$/.exec(name)?.[1];
}
