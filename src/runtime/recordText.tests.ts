import { addToken, addWrittenToken, addWrittenTokens, createTokenLines, endTokenLine, lineTokens, parseRecord, recordTokens, tokenLines, writeFieldTokens } from "./recordText";
import { beginFieldSlices, createFieldCursor, fieldSlicesOpen, writeFieldSlice } from "./recordSlices";
import { assertDefined, assertEquals, assertTrue, test } from "./testing";
import { floorMod } from "../sim/intMath";

function withGaps(): (number | undefined)[] {
  const items: (number | undefined)[] = [];
  items[1] = 4;
  items[3] = 0.25;
  return items;
}

function sample(): Record<string, unknown> {
  return {
    count: 7, negative: -5, largest: 2147483647, smallest: -2147483648, zero: 0,
    half: 0.5, tenth: 0.10000000149011612, nearTwo: 1.9999998807907104, wide: 16777215.0, whole: 2.0, minus: -1.25,
    huge: 3.4028234663852886e38, tiny: 1.1754943508222875e-38,
    on: true, off: false, name: "Stand Ready", odd: "a%b'c",
    nested: { inner: { depth: 3 }, list: [1, 2, 3] },
    gaps: withGaps(),
    rows: [{ x: 1.5 }, { x: -2 }],
    none: undefined, empty: [],
  };
}

/** Tokens in a fixed order: Lua visits a record's fields in no particular order. */
const sorted = (tokens: readonly string[]) => [...tokens].sort().join(" ");

function numberKeyedKit(): Record<string, unknown> {
  const poses: Record<number, number> = {};
  poses[-2] = 15;
  poses[0] = 7;
  poses[5] = 9;
  const normals: Record<number, unknown> = {};
  normals[0] = { frames: 3, poses };
  normals[2] = { frames: 4 };
  normals[7] = { frames: 1 };
  const throws: Record<number, string> = {};
  throws[-1] = "back";
  throws[3] = "up";
  return { normals, list: [{ throws }], plain: [10, 20, 30] };
}

const NUMBER_KEYED = ["normals", "poses", "throws"];

test("[invariant] record text: values, kinds and nesting survive a round trip exactly", () => {
  const record = sample();
  const tokens = assertDefined(recordTokens(record), "tokens");
  const back = assertDefined(parseRecord(lineTokens(tokenLines(tokens, 40))), "record");

  assertEquals(sorted(assertDefined(recordTokens(back), "tokens again")), sorted(tokens));
  for (const name of ["count", "negative", "largest", "smallest", "half", "tenth", "nearTwo", "wide", "whole", "minus", "huge", "tiny", "name", "odd"]) {
    assertEquals(back[name], record[name], name);
  }
  assertEquals(back.none, undefined);
  // Records keyed by numbers keep their keys, alike in Bun and Lua (#25).
  const keyed = assertDefined(recordTokens(numberKeyedKit(), NUMBER_KEYED), "keyed tokens");
  const keyedBack = assertDefined(parseRecord(lineTokens(tokenLines(keyed, 40))), "keyed record");
  assertEquals(sorted(assertDefined(recordTokens(keyedBack, NUMBER_KEYED), "keyed tokens again")), sorted(keyed));
});

function packed(tokens: readonly string[], prefix: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let length = -1;
  for (const token of tokens) {
    if (length >= 0 && length + 1 + token.length > width) {
      lines.push(`${prefix}${line}`);
      line = "";
      length = -1;
    }
    line = length < 0 ? token : `${line} ${token}`;
    length += 1 + token.length;
  }
  if (length >= 0) lines.push(`${prefix}${line}`);
  return lines;
}

test("[invariant] record text: fields written into reused line buffers give the lines of their packed recordTokens", () => {
  for (const [record, keyedByInteger] of [[sample(), []], [numberKeyedKit(), NUMBER_KEYED]] as const) {
    for (const width of [12, 40]) {
      const tokens: string[] = [];
      const sink = createTokenLines("state ", width);
      for (const key in record) {
        const value = record[key];
        if (value === undefined) continue;
        const field: Record<string, unknown> = {};
        field[key] = value;
        for (const token of assertDefined(recordTokens(field, keyedByInteger), key)) tokens.push(token);
        addWrittenTokens(sink, assertDefined(writeFieldTokens(key, value, keyedByInteger), key));
        const first = assertDefined(writeFieldTokens(key, value, keyedByInteger), key);
        if (first > 0) {
          const token = assertDefined(recordTokens(field, keyedByInteger)?.[0], key);
          tokens.push(`7${token.substring(key.length)}`);
          addWrittenToken(sink, 0, "7");
        }
        tokens.push("|");
        addToken(sink, "|");
      }
      endTokenLine(sink);
      assertEquals(sink.lines.join("\n"), packed(tokens, "state ", width).join("\n"), `width ${width}`);
    }
  }
});

const SLICED_KEYED = ["byKey"];
const FIELD_NAMES = ["a", "b", "c", "byKey"];

function randomValue(next: (below: number) => number, depth: number, name: string): unknown {
  const pick = depth === 0 ? 7 : next(depth >= 6 ? 5 : 8);
  if (pick === 0) return next(100) - 50;
  if (pick === 1) return 0.25 * (next(9) - 4) + 0.125;
  if (pick === 2) return next(2) === 0;
  if (pick === 3) return next(2) === 0 ? "a b'%" : "Stand";
  if (pick === 4) return undefined;
  if (name === "byKey") {
    const keyed: Record<number, unknown> = {};
    for (const key of [-2, 0, 5]) if (next(3) > 0) keyed[key] = randomValue(next, depth + 1, "keyed");
    return keyed;
  }
  if (pick === 5) {
    const items: unknown[] = [];
    for (let index = next(5) - 1; index >= 0; index--) items.push(randomValue(next, depth + 1, "item"));
    return items;
  }
  const record: Record<string, unknown> = {};
  for (const field of FIELD_NAMES) if (next(3) > 0) record[field] = randomValue(next, depth + 1, field);
  return record;
}

function slicedLines(value: unknown, size: number): string {
  const sink = createTokenLines("s ", 24);
  const cursor = createFieldCursor();
  assertTrue(beginFieldSlices(cursor, "state", value, SLICED_KEYED));
  while (fieldSlicesOpen(cursor)) addWrittenTokens(sink, assertDefined(writeFieldSlice(cursor, size), "slice"));
  endTokenLine(sink);
  return sink.lines.join("\n");
}

test("[property seed 55] record text: a field written in slices of any size gives the text of writing it whole", () => {
  let seed = 55;
  const next = (below: number) => {
    seed = floorMod(seed * 75 + 74, 65537);
    return floorMod(seed, below);
  };
  for (let round = 0; round < 60; round++) {
    const value = randomValue(next, 0, "state");
    const sink = createTokenLines("s ", 24);
    addWrittenTokens(sink, assertDefined(writeFieldTokens("state", value, SLICED_KEYED), "whole"));
    endTokenLine(sink);
    const size = 1 + next(12);
    assertEquals(slicedLines(value, size), sink.lines.join("\n"), `round ${round} slices of ${size}`);
  }
});

function deepRecord(levels: number): Record<string, unknown> {
  let record: Record<string, unknown> = { leaf: 1 };
  for (let level = 0; level < levels; level++) record = { x: level, list: [level, 0.5, "s"], inner: record, y: true };
  return record;
}

test("[invariant] record text: a slice of N steps writes at most N tokens of a deeply nested field, and N unless it ends the field", () => {
  const record = deepRecord(28);
  const whole = assertDefined(writeFieldTokens("state", record), "whole");
  const cursor = createFieldCursor();
  for (const size of [1, 3, 32]) {
    assertTrue(beginFieldSlices(cursor, "state", record));
    let total = 0;
    while (fieldSlicesOpen(cursor)) {
      const count = assertDefined(writeFieldSlice(cursor, size), "slice");
      assertTrue(count <= size && cursor.steps <= size);
      if (fieldSlicesOpen(cursor)) assertEquals(count, size, `slice of ${size} at token ${total}`);
      total += count;
    }
    assertEquals(total, whole, `slices of ${size}`);
  }
});
