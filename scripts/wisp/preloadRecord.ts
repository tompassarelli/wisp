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

export interface GameFileKind<A> {
  readonly decode: (file: string, text: string) => Effect.Effect<A, MalformedGameFile>;
}

const PRELOAD_HEADER = /^function PreloadFiles takes nothing returns nothing\r?\n/;
const PRELOAD_LINE = /^\s*call Preload\( "(.*)" \)[\t ]*\r?$/gm;

export function preloadLines(text: string): string[] | undefined {
  if (!PRELOAD_HEADER.test(text) || !text.trimEnd().endsWith("endfunction")) return undefined;
  return [...text.matchAll(PRELOAD_LINE)].map((match) => match[1] ?? "");
}

const FIELD = /^\{(\w+)\}$/;

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

export interface Layout {

  readonly head?: readonly string[];

  readonly rest?: string;

  readonly tail?: readonly string[];
}

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
      return yield* Schema.decodeEffect(schema)(fields).pipe(Effect.mapError((error) => {
        const issue = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues[0];
        return malformed(issue?.path === undefined || issue.path.length === 0 ? "record" : issue.path.join("."), issue?.message ?? error.message);
      }));
    }),
  };
}

export const Count = Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const Seconds = Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0));

export const Acknowledgement = preloadRecord(
  { head: ["applied {version} at {elapsed}"] },
  Schema.Struct({ version: Count, elapsed: Seconds }),
);

export const ErrorReport = preloadRecord(
  { head: ["error {count} in {handler}"], rest: "lines" },
  Schema.Struct({ count: Count.check(Schema.isGreaterThanOrEqualTo(1)), handler: Schema.NonEmptyString, lines: Schema.Array(Schema.String) }),
);

export const FILE_SLOT_NUMBERS: readonly number[] = Array.from({ length: FILE_SLOTS }, (_, slot) => slot);

export function linePreloadFile(line: string): string {
  return `function PreloadFiles takes nothing returns nothing\ncall BlzSetAbilityTooltip('$wsl', "${line}", 0)\nendfunction\n`;
}

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

// Both checksum lanes stay below 2^31, where JavaScript % agrees with payload.ts floorMod.

export function bytesChecksum(bytes: Uint8Array): string {
  let first = 0;
  let second = 0;
  for (const byte of bytes) {
    first = (first * 257 + byte + 1) % 8165329;
    second = (second * 263 + byte + 1) % 8165323;
  }
  return `${first}:${second}`;
}

export const hostPath = (directory: string, gamePath: string) => join(directory, ...gamePath.split("\\"));

export function manifestVersion(name: string): number | undefined {
  const version = /^manifest-(\d+)\.pld$/.exec(name)?.[1];
  return version === undefined ? undefined : Number(version);
}

export function payloadFileKey(name: string): string | undefined {
  return /^(\d+-\d+(?:-\d+-\d+)?)-\d+\.pld$/.exec(name)?.[1];
}
