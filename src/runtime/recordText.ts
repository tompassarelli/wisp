// Lua32's seven-digit float text loses bits; records must retain exact values and Lua number kinds.

// Tokens use NAME=VALUE, NAME{, NAME[, NAME#, } and ]; strings percent-escape bytes outside letters, digits, _, . and -.

// %XX. Undefined fields and elements are left out, as Lua leaves them out.

import { floorDiv } from "../sim/intMath";

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null;

const MAX_DEPTH = 32;
const TWO_26 = 67108864.0;
const LARGEST_INTEGER = 2147483647;
const SMALLEST_INTEGER = -2147483648;

const isDigit = (code: number) => code >= 48 && code <= 57;
const isNameCode = (code: number) => isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
const isPlainCode = (code: number) => isNameCode(code) || code === 46 || code === 45;

function isName(text: string): boolean {
  if (text.length === 0) return false;
  for (let index = 0; index < text.length; index++) if (!isNameCode(text.charCodeAt(index))) return false;
  return true;
}

function isDecimal(text: string): boolean {
  const start = text.charAt(0) === "-" ? 1 : 0;
  if (text.length <= start) return false;
  for (let index = start; index < text.length; index++) if (!isDigit(text.charCodeAt(index))) return false;
  return true;
}

// Lua distinguishes integers from floats in their printed form; Bun integers are restricted to signed 32 bits.

const isInteger = (value: number) => isDecimal(`${value}`) && value >= SMALLEST_INTEGER && value <= LARGEST_INTEGER;

function infinity(): number {

  let result = 16777216.0;
  for (let step = 1; step <= 6; step++) result *= result;
  return result;
}

function realText(value: number): string {
  if (value !== value) return "~nan";
  const negative = value < 0 || (value === 0 && `${value}`.charAt(0) === "-");
  let magnitude = negative ? -value : value;
  if (magnitude === 0) return negative ? "~-0" : "~0";
  if (magnitude * 2.0 === magnitude) return negative ? "~-inf" : "~inf";
  let exponent = 0;
  while (magnitude >= 2.0) {
    magnitude *= 0.5;
    exponent++;
  }
  while (magnitude < 1.0) {
    magnitude *= 2.0;
    exponent--;
  }
  const scaled = (magnitude - 1.0) * TWO_26;
  const high = Math.floor(scaled);
  const low = Math.floor((scaled - high) * TWO_26);
  return `~${negative ? "-" : "+"}${exponent}:${high}:${low}`;
}

function parseInteger(text: string): number | undefined {
  if (!isDecimal(text)) return undefined;
  const negative = text.charAt(0) === "-";
  let result = 0;
  for (let index = negative ? 1 : 0; index < text.length; index++) result = result * 10 + (text.charCodeAt(index) - 48);
  return negative ? -result : result;
}

function parseReal(text: string): number | undefined {
  if (text === "~0") return 0.0;
  if (text === "~-0") return -0.0;
  if (text === "~inf") return infinity();
  if (text === "~-inf") return -infinity();
  if (text === "~nan") return infinity() - infinity();
  const sign = text.charAt(1);
  if (sign !== "+" && sign !== "-") return undefined;
  const parts = text.substring(2).split(":");
  if (parts.length !== 3) return undefined;
  const exponent = parseInteger(parts[0] ?? "");
  const high = parseInteger(parts[1] ?? "");
  const low = parseInteger(parts[2] ?? "");
  if (exponent === undefined || high === undefined || low === undefined) return undefined;
  if (high < 0 || high >= TWO_26 || low < 0 || low >= TWO_26 || exponent < -1100 || exponent > 1100) return undefined;
  let value = 1.0 + (high + low / TWO_26) / TWO_26;
  for (let step = 0; step < exponent; step++) value *= 2.0;
  for (let step = 0; step > exponent; step--) value *= 0.5;
  return sign === "-" ? -value : value;
}

const HEX = "0123456789ABCDEF";

function stringText(value: string): string | undefined {
  let text = "'";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 255) return undefined;
    text += isPlainCode(code) ? value.charAt(index) : `%${HEX.charAt(floorDiv(code, 16))}${HEX.charAt(code & 15)}`;
  }
  return text;
}

function parseString(text: string): string | undefined {
  let value = "";
  let index = 1;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character !== "%") {
      if (!isPlainCode(text.charCodeAt(index))) return undefined;
      value += character;
      index++;
      continue;
    }
    if (index + 2 >= text.length) return undefined;
    const high = HEX.indexOf(text.charAt(index + 1));
    const low = HEX.indexOf(text.charAt(index + 2));
    if (high < 0 || low < 0) return undefined;
    value += String.fromCharCode(high * 16 + low);
    index += 3;
  }
  return value;
}

function numberText(value: number): string {
  const text = `${value}`;
  return isDecimal(text) && value >= SMALLEST_INTEGER && value <= LARGEST_INTEGER ? text : realText(value);
}

function valueText(value: unknown): string | undefined {
  if (value === true) return "T";
  if (value === false) return "F";
  if (typeof value === "number") return numberText(value);
  if (typeof value === "string") return stringText(value);
  return undefined;
}

function parseValue(text: string): unknown {
  if (text === "T") return true;
  if (text === "F") return false;
  const first = text.charAt(0);
  if (first === "~") return parseReal(text);
  if (first === "'") return parseString(text);
  return parseInteger(text);
}

const isFieldName = (text: string) => isName(text) && !isDecimal(text);

function integerName(text: string): number | undefined {
  const value = parseInteger(text);
  return value !== undefined && isInteger(value) && `${value}` === text ? value : undefined;
}

// for...in returns numeric integer keys in Lua and string keys in Bun.

function integerKey(key: string): number | undefined {
  const raw: unknown = key;
  if (typeof raw === "number") return isInteger(raw) ? raw : undefined;
  return integerName(key);
}

export class IntegerKeysUndeclared extends Error {}

interface Writer {
  readonly parts: string[];
  count: number;
  keyed: Readonly<Record<string, boolean>>;
  keyedFrom: readonly string[] | undefined;
  readonly path: string[];
}

const writer: Writer = { parts: [], count: 0, keyed: {}, keyedFrom: undefined, path: [] };

function token(name: string, mark: string, text: string): void {
  const { parts } = writer;
  const at = writer.count * 3;
  parts[at] = name;
  parts[at + 1] = mark;
  parts[at + 2] = text;
  writer.count++;
}

const NAMES: string[] = [];

function indexName(index: number): string {
  if (index < 0 || index >= 4096) return `${index}`;
  const known = NAMES[index];
  if (known !== undefined) return known;
  const name = `${index}`;
  NAMES[index] = name;
  return name;
}

function keyedName(key: string): string {
  const index = integerKey(key);
  return index === undefined ? `${index}` : indexName(index);
}

function begin(keyedByInteger: readonly string[]): void {
  writer.count = 0;
  writer.path.length = 0;
  if (writer.keyedFrom === keyedByInteger) return;
  const keyed: Record<string, boolean> = {};
  for (const name of keyedByInteger) keyed[name] = true;
  writer.keyed = keyed;
  writer.keyedFrom = keyedByInteger;
}

function writtenTokens(): string[] {
  const { parts } = writer;
  const tokens: string[] = [];
  for (let index = 0; index < writer.count; index++) tokens.push(`${parts[index * 3]}${parts[index * 3 + 1]}${parts[index * 3 + 2]}`);
  return tokens;
}

function undeclared(writer: Writer, why: string): never {
  throw new IntegerKeysUndeclared(`record text: ${writer.path.join(".")} ${why}`);
}

// Lua arrays use integer keys from 1 and omit undefined elements; integer-keyed records require a declared field name.

function arrayLength(value: Fields): number | undefined | false {
  let length: number | undefined;
  let named = false;
  for (const key in value) {
    const raw: unknown = key;
    if (typeof raw !== "number") named = true;
    else if (!isInteger(raw) || raw < 1) return false;
    else length = Math.max(length ?? 0, raw);
  }
  if (length !== undefined) return named ? false : length;
  if (Array.isArray(value)) return value.length;
  for (const key in value) if (isDecimal(key)) return false;
  return undefined;
}

const isList = (_value: unknown, length: number | undefined): _value is readonly unknown[] => length !== undefined;

function isKeyed(value: Fields): boolean {
  let numbers = false;
  for (const key in value) {
    const raw: unknown = key;
    if (typeof raw === "number") numbers = true;
    if (integerKey(key) === undefined) return false;
  }
  return numbers || !Array.isArray(value) || value.length === 0;
}

function writeValue(writer: Writer, name: string, value: unknown, depth: number): boolean {
  if (value === undefined) return true;
  if (!isFields(value)) {
    const text = valueText(value);
    if (text === undefined) return false;
    token(name, "=", text);
    return true;
  }
  if (depth >= MAX_DEPTH) return false;
  writer.path.push(name);
  if (writer.keyed[name] === true) {
    if (!isKeyed(value)) undeclared(writer, "is declared keyed by integers but has other keys or is an array");
    token(name, "#", "");
    for (const key in value) if (!writeValue(writer, keyedName(key), value[key], depth + 1)) return false;
    token("", "}", "");
  } else {
    const length = arrayLength(value);
    if (length === false) undeclared(writer, "is keyed by integers but not declared so in recordTokens, or mixes integer and named keys");
    const items: unknown = value;
    if (isList(items, length)) {
      token(name, "[", "");
      for (let index = 0; index < (length ?? 0); index++) if (!writeValue(writer, indexName(index), items[index], depth + 1)) return false;
      token("", "]", "");
    } else {
      token(name, "{", "");
      if (!writeFields(writer, value, depth + 1)) return false;
      token("", "}", "");
    }
  }
  writer.path.pop();
  return true;
}

function writeFields(writer: Writer, record: Fields, depth: number): boolean {
  for (const key in record) {
    if (!isFieldName(key) || !writeValue(writer, key, record[key], depth)) return false;
  }
  return true;
}

// Lua cannot distinguish arrays from integer-keyed records; declare keyed fields to preserve keys on round trips.

const NO_KEYED: readonly string[] = [];

export function recordTokens(record: object, keyedByInteger: readonly string[] = NO_KEYED): string[] | undefined {
  if (!isFields(record) || arrayLength(record) !== undefined) return undefined;
  begin(keyedByInteger);
  return writeFields(writer, record, 0) ? writtenTokens() : undefined;
}

export function writeFieldTokens(name: string, value: unknown, keyedByInteger: readonly string[] = NO_KEYED): number | undefined {
  if (!isFieldName(name)) return undefined;
  begin(keyedByInteger);
  return writeValue(writer, name, value, 0) ? writer.count : undefined;
}

// An export list keeps these Lua locals; an exported function would cost a table lookup on every call.

export { MAX_DEPTH, arrayLength, indexName, isFieldName, isFields, isKeyed, keyedName, token, valueText, writer };

export interface TokenLines {
  width: number;
  prefix: string;
  lines: string[];
  readonly parts: string[];
  size: number;
  tokens: number;
  length: number;
}

export function createTokenLines(prefix: string, width: number, lines: string[] = []): TokenLines {
  return { width, prefix, lines, parts: [prefix], size: 1, tokens: 0, length: -1 };
}

export function openTokenLines(sink: TokenLines, prefix: string, width: number, lines: string[]): void {
  sink.width = width;
  sink.prefix = prefix;
  sink.lines = lines;
  sink.parts[0] = prefix;
  sink.size = 1;
  sink.tokens = 0;
  sink.length = -1;
}

function makeRoom(sink: TokenLines, size: number): void {
  if (sink.tokens > 0 && sink.length + 1 + size > sink.width) endTokenLine(sink);
  if (sink.tokens > 0) sink.parts[sink.size++] = " ";
  sink.tokens++;
  sink.length += 1 + size;
}

export function addToken(sink: TokenLines, text: string): void {
  makeRoom(sink, text.length);
  sink.parts[sink.size++] = text;
}

export function addWrittenToken(sink: TokenLines, index: number, name?: string): void {
  const { parts } = writer;
  const first = name ?? parts[index * 3] ?? "";
  const mark = parts[index * 3 + 1] ?? "";
  const text = parts[index * 3 + 2] ?? "";
  makeRoom(sink, first.length + mark.length + text.length);
  const line = sink.parts;
  line[sink.size++] = first;
  line[sink.size++] = mark;
  line[sink.size++] = text;
}

export function addWrittenTokens(sink: TokenLines, count: number): void {
  for (let index = 0; index < count; index++) addWrittenToken(sink, index);
}

export function endTokenLine(sink: TokenLines): void {
  if (sink.tokens === 0) return;
  const { parts } = sink;
  parts.length = sink.size;
  sink.lines.push(parts.join(""));
  sink.size = 1;
  sink.tokens = 0;
  sink.length = -1;
}

interface Open {
  readonly fields: Record<string, unknown> | undefined;
  readonly items: unknown[] | undefined;
  readonly keyed: Record<number, unknown> | undefined;
}

function place(open: Open, name: string, value: unknown): boolean {
  if (open.fields !== undefined) {
    if (!isFieldName(name)) return false;
    open.fields[name] = value;
    return true;
  }
  if (open.keyed !== undefined) {
    const key = integerName(name);
    if (key === undefined) return false;
    open.keyed[key] = value;
    return true;
  }
  const index = parseInteger(name);
  if (open.items === undefined || index === undefined || index < 0) return false;
  open.items[index] = value;
  return true;
}

function opened(last: string): Open {
  if (last === "{") return { fields: {}, items: undefined, keyed: undefined };
  if (last === "[") return { fields: undefined, items: [], keyed: undefined };
  return { fields: undefined, items: undefined, keyed: {} };
}

export function parseRecord(tokens: readonly string[]): Record<string, unknown> | undefined {
  const root: Record<string, unknown> = {};
  const stack: Open[] = [{ fields: root, items: undefined, keyed: undefined }];
  for (const token of tokens) {
    const open = stack[stack.length - 1];
    if (open === undefined) return undefined;
    if (token === "}" || token === "]") {
      if (stack.length === 1 || (token === "}") !== (open.items === undefined)) return undefined;
      stack.pop();
      continue;
    }
    const last = token.charAt(token.length - 1);
    if (last === "{" || last === "[" || last === "#") {
      const child = opened(last);
      if (!place(open, token.substring(0, token.length - 1), child.fields ?? child.items ?? child.keyed)) return undefined;
      stack.push(child);
      continue;
    }
    const equals = token.indexOf("=");
    const value = equals < 0 ? undefined : parseValue(token.substring(equals + 1));
    if (value === undefined || !place(open, token.substring(0, equals), value)) return undefined;
  }
  return stack.length === 1 ? root : undefined;
}

export function tokenLines(tokens: readonly string[], width: number): string[] {
  const sink = createTokenLines("", width);
  for (const text of tokens) addToken(sink, text);
  endTokenLine(sink);
  return sink.lines;
}

export function lineTokens(lines: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const line of lines) for (const token of line.split(" ")) if (token.length > 0) tokens.push(token);
  return tokens;
}
