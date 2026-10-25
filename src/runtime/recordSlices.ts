import { IntegerKeysUndeclared, MAX_DEPTH, arrayLength, indexName, isFieldName, isFields, isKeyed, keyedName, token, valueText, writer } from "./recordText";

type Fields = Readonly<Record<string, unknown>>;

const FAILED = 0;
const WROTE = 1;
const FIELDS = 2;
const LIST = 3;
const KEYED = 4;
const ROOT = 5;

interface Frame {
  record: Fields;
  items: readonly unknown[];
  kind: number;
  next: number;
  end: number;
  readonly keys: string[];
  name: string;
  value: unknown;
}

export interface FieldCursor {
  readonly frames: Frame[];
  depth: number;
  steps: number;
  keyed: Readonly<Record<string, boolean>>;
  keyedFrom: readonly string[] | undefined;
  readonly path: string[];
}

export const createFieldCursor = (): FieldCursor => ({ frames: [], depth: 0, steps: 0, keyed: {}, keyedFrom: undefined, path: [] });

export const fieldSlicesOpen = (cursor: FieldCursor) => cursor.depth > 0;

const isList = (_value: unknown, length: number | undefined): _value is readonly unknown[] => length !== undefined;

const NO_FIELDS: Fields = {};
const NO_ITEMS: readonly unknown[] = [];

function push(cursor: FieldCursor, record: Fields, items: readonly unknown[], kind: number, end: number): Frame {
  const at = cursor.depth++;
  let frame = cursor.frames[at];
  if (frame === undefined) {
    frame = { record, items, kind, next: 0, end, keys: [], name: "", value: undefined };
    cursor.frames[at] = frame;
  }
  frame.record = record;
  frame.items = items;
  frame.kind = kind;
  frame.next = 0;
  frame.end = end;
  if (kind !== FIELDS && kind !== KEYED) return frame;
  const { keys } = frame;
  let count = 0;
  for (const key in record) keys[count++] = key;
  frame.end = count;
  return frame;
}

function undeclared(cursor: FieldCursor, why: string): never {
  const path = cursor.path.join(".");
  cursor.depth = 0;
  throw new IntegerKeysUndeclared(`record text: ${path} ${why}`);
}

function open(cursor: FieldCursor, name: string, value: Fields): number {
  if (cursor.depth > MAX_DEPTH) return FAILED;
  cursor.path.push(name);
  if (cursor.keyed[name] === true) {
    if (!isKeyed(value)) undeclared(cursor, "is declared keyed by integers but has other keys or is an array");
    token(name, "#", "");
    push(cursor, value, NO_ITEMS, KEYED, 0);
    return KEYED;
  }
  const length = arrayLength(value);
  if (length === false) undeclared(cursor, "is keyed by integers but not declared so in recordTokens, or mixes integer and named keys");
  const items: unknown = value;
  if (isList(items, length)) {
    token(name, "[", "");
    push(cursor, NO_FIELDS, items, LIST, length ?? 0);
    return LIST;
  }
  token(name, "{", "");
  push(cursor, value, NO_ITEMS, FIELDS, 0);
  return FIELDS;
}

function enter(cursor: FieldCursor, name: string, value: unknown): number {
  if (value === undefined) return WROTE;
  if (isFields(value)) return open(cursor, name, value);
  const text = valueText(value);
  if (text === undefined) return FAILED;
  token(name, "=", text);
  return WROTE;
}

function stepFrame(cursor: FieldCursor, frame: Frame, budget: number): number {
  const { kind, record, items, keys, end } = frame;
  let next = frame.next;
  let steps = 0;
  let result = WROTE;
  while (next < end && steps < budget && result === WROTE) {
    const index = next++;
    steps++;
    if (kind === LIST) result = enter(cursor, indexName(index), items[index]);
    else if (kind === ROOT) result = enter(cursor, frame.name, frame.value);
    else {
      const key = keys[index] ?? "";
      if (kind === KEYED) result = enter(cursor, keyedName(key), record[key]);
      else result = isFieldName(key) ? enter(cursor, key, record[key]) : FAILED;
    }
  }
  frame.next = next;
  if (result === FAILED) return -1;
  if (result !== WROTE || next < end || steps >= budget) return steps;
  cursor.depth--;
  if (kind === ROOT) return steps + 1;
  token("", kind === LIST ? "]" : "}", "");
  cursor.path.pop();
  return steps + 1;
}

const NO_KEYED: readonly string[] = [];

export function beginFieldSlices(cursor: FieldCursor, name: string, value: unknown, keyedByInteger: readonly string[] = NO_KEYED): boolean {
  if (!isFieldName(name)) return false;
  cursor.depth = 0;
  cursor.steps = 0;
  cursor.path.length = 0;
  if (cursor.keyedFrom !== keyedByInteger) {
    const keyed: Record<string, boolean> = {};
    for (const field of keyedByInteger) keyed[field] = true;
    cursor.keyed = keyed;
    cursor.keyedFrom = keyedByInteger;
  }
  const frame = push(cursor, NO_FIELDS, NO_ITEMS, ROOT, 1);
  frame.name = name;
  frame.value = value;
  return true;
}

export function writeFieldSlice(cursor: FieldCursor, budget: number): number | undefined {
  writer.count = 0;
  let steps = 0;
  while (cursor.depth > 0 && steps < budget) {
    const frame = cursor.frames[cursor.depth - 1];
    const taken = frame === undefined ? -1 : stepFrame(cursor, frame, budget - steps);
    if (taken < 0) {
      cursor.depth = 0;
      cursor.steps = steps;
      return undefined;
    }
    steps += taken;
  }
  cursor.steps = steps;
  return writer.count;
}
