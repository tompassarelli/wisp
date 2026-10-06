// Plain records as text and back, alike in Bun and in Warcraft's Lua: nested
// records and arrays of numbers, booleans and strings, such as a game's match
// state in a repro (wisp:docs/repro.md). Integers and reals keep Lua's number
// kind, and a real its exact binary value, which Lua's own text for a number
// (seven digits in 32-bit Lua) doesn't.
//
// Tokens: `NAME=VALUE` is a field, `NAME{` and `NAME[` open a record or an
// array, `}` and `]` close it; an array's names are its indices. `NAME#`
// opens a record keyed by integers, such as a kit's moves by action number,
// and `}` closes it; its names are its keys. Values are T
// and F, an integer's decimal digits, `~` and a real's exact form, or `'` and
// a string's bytes with every byte but letters, digits, `_`, `.` and `-` as
// %XX. Undefined fields and elements are left out, as Lua leaves them out.

import { floorDiv } from "../sim/intMath";

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null;

/** Records nested deeper than this are taken for a cycle. */
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

/** Whether `text` is an optional minus and decimal digits. */
function isDecimal(text: string): boolean {
  const start = text.charAt(0) === "-" ? 1 : 0;
  if (text.length <= start) return false;
  for (let index = start; index < text.length; index++) if (!isDigit(text.charCodeAt(index))) return false;
  return true;
}

/**
 * Whether Lua holds the value as an integer: it prints a float with a point
 * or an exponent, and an integer as digits. In Bun, a whole number within
 * Warcraft's 32-bit integers.
 */
const isInteger = (value: number) => isDecimal(`${value}`) && value >= SMALLEST_INTEGER && value <= LARGEST_INTEGER;

function infinity(): number {
  // Squaring overflows binary32 and binary64 without dividing by zero.
  let result = 16777216.0;
  for (let step = 1; step <= 6; step++) result *= result;
  return result;
}

/** A real's exact form: sign, binary exponent and 52 fraction bits as two 26-bit integers. Every step is exact. */
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

function valueText(value: unknown): string | undefined {
  if (value === true) return "T";
  if (value === false) return "F";
  if (typeof value === "number") return isInteger(value) ? `${value}` : realText(value);
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

/** A field's name: letters, digits and `_`, not an integer's digits, which a record keyed by integers writes as `#`. */
const isFieldName = (text: string) => isName(text) && !isDecimal(text);

/** The integer an integer key's text spells, written the way `${}` writes it; undefined for any other text. */
function integerName(text: string): number | undefined {
  const value = parseInteger(text);
  return value !== undefined && isInteger(value) && `${value}` === text ? value : undefined;
}

/**
 * The integer a record's key is: `for...in` gives a number in Lua and its
 * text in Bun.
 */
function integerKey(key: string): number | undefined {
  const raw: unknown = key;
  if (typeof raw === "number") return isInteger(raw) ? raw : undefined;
  return integerName(key);
}

/** Integers' keys, as a list of keyed records' names. */
type KeyedNames = Readonly<Record<string, boolean>>;

/**
 * An array's length; undefined when `value` is a record. In Lua a
 * TypeScript array is a table whose keys are integers from 1, with no key for
 * an undefined element, so its length is its largest key; in Bun an array has
 * string keys and a length. A table with any other key beside them, or a Bun
 * object keyed by integers, is neither (false): a record keyed by integers is
 * the same Lua table as an array, so only its declared name tells them apart.
 */
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

/** Lets an array arrayLength found be indexed as one, which TypeScriptToLua offsets for Lua's tables from 1. */
const isList = (_value: unknown, length: number | undefined): _value is readonly unknown[] => length !== undefined;

/** Whether `value` can be written as a record keyed by integers: every key an integer, and not a Bun array. */
function isKeyed(value: Fields): boolean {
  let numbers = false;
  for (const key in value) {
    const raw: unknown = key;
    if (typeof raw === "number") numbers = true;
    if (integerKey(key) === undefined) return false;
  }
  return numbers || !Array.isArray(value) || value.length === 0;
}

function writeValue(tokens: string[], name: string, value: unknown, depth: number, keyed: KeyedNames): boolean {
  if (value === undefined) return true;
  if (!isFields(value)) {
    const text = valueText(value);
    if (text === undefined) return false;
    tokens.push(`${name}=${text}`);
    return true;
  }
  if (depth >= MAX_DEPTH) return false;
  if (keyed[name] === true) {
    if (!isKeyed(value)) return false;
    tokens.push(`${name}#`);
    for (const key in value) if (!writeValue(tokens, `${integerKey(key)}`, value[key], depth + 1, keyed)) return false;
    tokens.push("}");
    return true;
  }
  const length = arrayLength(value);
  if (length === false) return false;
  const items: unknown = value;
  if (isList(items, length)) {
    tokens.push(`${name}[`);
    for (let index = 0; index < (length ?? 0); index++) if (!writeValue(tokens, `${index}`, items[index], depth + 1, keyed)) return false;
    tokens.push("]");
    return true;
  }
  tokens.push(`${name}{`);
  if (!writeFields(tokens, value, depth + 1, keyed)) return false;
  tokens.push("}");
  return true;
}

function writeFields(tokens: string[], record: Fields, depth: number, keyed: KeyedNames): boolean {
  for (const key in record) {
    if (!isFieldName(key) || !writeValue(tokens, key, record[key], depth, keyed)) return false;
  }
  return true;
}

/**
 * The tokens of a record's fields. A field named in `keyedByInteger` holds
 * a record keyed by integers (`{ readonly [action: number]: T }`), written
 * with its keys; Lua can't tell one from an array, so any other value keyed by
 * integers is written as an array, and one with a key below 1 is refused.
 * Undefined when the record holds anything else: a function, a cycle, a
 * string byte above 255 or a key that isn't letters, digits and `_`.
 */
export function recordTokens(record: object, keyedByInteger: readonly string[] = []): string[] | undefined {
  if (!isFields(record) || arrayLength(record) !== undefined) return undefined;
  const keyed: Record<string, boolean> = {};
  for (const name of keyedByInteger) keyed[name] = true;
  const tokens: string[] = [];
  return writeFields(tokens, record, 0, keyed) ? tokens : undefined;
}

/** A record, array or record keyed by integers being filled; exactly one of the three. */
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

/** The record that recordTokens wrote `tokens` for; undefined when they are malformed. */
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

/** Tokens joined by spaces into lines of at most `width` characters; a longer token has a line of its own. */
export function tokenLines(tokens: readonly string[], width: number): string[] {
  const lines: string[] = [];
  // Each line is joined once: appending token by token copies the line for every token.
  let line: string[] = [];
  let length = -1;
  for (const token of tokens) {
    if (line.length > 0 && length + 1 + token.length > width) {
      lines.push(line.join(" "));
      line = [];
      length = -1;
    }
    line.push(token);
    length += 1 + token.length;
  }
  if (line.length > 0) lines.push(line.join(" "));
  return lines;
}

/** The tokens of lines that tokenLines wrote. */
export function lineTokens(lines: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const line of lines) for (const token of line.split(" ")) if (token.length > 0) tokens.push(token);
  return tokens;
}
