import { lineTokens, parseRecord, recordTokens, tokenLines } from "./recordText";
import { type Repro, assertReproLands, parseRepro, reproLines } from "./repro";
import { assertDefined, assertEquals, assertTrue, test } from "./testing";

/** An array whose first and third elements are undefined. */
function withGaps(): (number | undefined)[] {
  const items: (number | undefined)[] = [];
  items[1] = 4;
  items[3] = 0.25;
  return items;
}

/** Values whose binary32 text Lua prints with too few digits to read back, and Lua's two number kinds. */
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

test("record text: values, kinds and nesting survive a round trip exactly", () => {
  const record = sample();
  const tokens = assertDefined(recordTokens(record), "tokens");
  const back = assertDefined(parseRecord(lineTokens(tokenLines(tokens, 40))), "record");
  // Writing the record read back gives the same tokens: every value is equal and kept its number kind.
  assertEquals(sorted(assertDefined(recordTokens(back), "tokens again")), sorted(tokens));
  for (const name of ["count", "negative", "largest", "smallest", "half", "tenth", "nearTwo", "wide", "whole", "minus", "huge", "tiny", "name", "odd"]) {
    assertEquals(back[name], record[name], name);
  }
  assertEquals(back.none, undefined);
});

test("record text: lines stay within their width and a malformed token is refused", () => {
  const tokens = assertDefined(recordTokens(sample()), "tokens");
  for (const line of tokenLines(tokens, 40)) assertTrue(line.length <= 40);
  assertEquals(parseRecord(["count=7", "nested{"]), undefined);
  assertEquals(parseRecord(["count=7", "]"]), undefined);
  assertEquals(parseRecord(["half=~+1:2"]), undefined);
  assertEquals(parseRecord(["name='a%4"]), undefined);
  assertEquals(recordTokens({ handler: () => 1 }), undefined);
});

const COUNTER: Repro["lines"] = ["start 3", "add 4 5"];

/** A game whose state is a number and whose frames add to it. */
function replayCounter(repro: Repro) {
  let total = 0;
  let frames = 0;
  for (const line of repro.lines) {
    const [word, ...values] = line.split(" ");
    if (word === "start") total = Number(values[0]);
    else for (const value of values) {
      total += Number(value);
      frames++;
    }
  }
  return { checksum: `${total}`, frames, problems: [] };
}

test("repro: its lines name the build, frame and checksum, and a replay must reach that checksum", () => {
  const lines = reproLines({ build: "dev", frame: 2, checksum: "12" }, COUNTER);
  const repro = parseRepro(lines);
  assertTrue(typeof repro !== "string");
  if (typeof repro === "string") return;
  assertEquals(repro.build, "dev");
  assertEquals(repro.frame, 2);
  assertEquals(repro.lines.length, 2);
  assertReproLands(lines, replayCounter);
  assertTrue(typeof parseRepro(lines.slice(0, lines.length - 2)) === "string");
  let missed = false;
  try {
    assertReproLands(reproLines({ build: "dev", frame: 2, checksum: "13" }, COUNTER), replayCounter);
  } catch {
    missed = true;
  }
  assertTrue(missed);
});
