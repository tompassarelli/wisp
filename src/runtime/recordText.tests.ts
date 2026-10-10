import { lineTokens, parseRecord, recordTokens, tokenLines } from "./recordText";
import { assertDefined, assertEquals, test } from "./testing";


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
