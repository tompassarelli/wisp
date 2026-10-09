import { IntegerKeysUndeclared, lineTokens, parseRecord, recordTokens, tokenLines } from "./recordText";
import { type Repro, assertReproLands, parseRepro, reproLines } from "./repro";
import { assertDefined, assertEquals, assertTrue, test } from "./testing";


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

test("[invariant] record text: values, kinds and nesting survive a round trip exactly", () => {
  const record = sample();
  const tokens = assertDefined(recordTokens(record), "tokens");
  const back = assertDefined(parseRecord(lineTokens(tokenLines(tokens, 40))), "record");

  assertEquals(sorted(assertDefined(recordTokens(back), "tokens again")), sorted(tokens));
  for (const name of ["count", "negative", "largest", "smallest", "half", "tenth", "nearTwo", "wide", "whole", "minus", "huge", "tiny", "name", "odd"]) {
    assertEquals(back[name], record[name], name);
  }
  assertEquals(back.none, undefined);
});

test("[invariant] record text: lines stay within their width and a malformed token is refused", () => {
  const tokens = assertDefined(recordTokens(sample()), "tokens");
  for (const line of tokenLines(tokens, 40)) assertTrue(line.length <= 40);
  assertEquals(parseRecord(["count=7", "nested{"]), undefined);
  assertEquals(parseRecord(["count=7", "]"]), undefined);
  assertEquals(recordTokens({ handler: () => 1 }), undefined);
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;


const isKeyed = (value: unknown): value is Readonly<Record<number, unknown>> => typeof value === "object" && value !== null;

function keyedAt(value: unknown, ...keys: readonly number[]): unknown {
  let current = value;
  for (const key of keys) current = isKeyed(current) ? current[key] : undefined;
  return current;
}


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

test("[repro #25] record text: records keyed by numbers keep their keys, alike in Bun and Lua", () => {
  const tokens = assertDefined(recordTokens(numberKeyedKit(), NUMBER_KEYED), "tokens");
  assertEquals(sorted(tokens), sorted([
    "normals#", "0{", "frames=3", "poses#", "-2=15", "0=7", "5=9", "}", "}", "2{", "frames=4", "}", "7{", "frames=1", "}", "}",
    "list[", "0{", "throws#", "-1='back", "3='up", "}", "}", "]",
    "plain[", "0=10", "1=20", "2=30", "]",
  ]));
  const back = assertDefined(parseRecord(lineTokens(tokenLines(tokens, 40))), "record");
  assertEquals(sorted(assertDefined(recordTokens(back, NUMBER_KEYED), "tokens again")), sorted(tokens));
  const normals = back.normals;
  assertEquals(keyedAt(normals, 0, -1), undefined);
  assertEquals(keyedAt(normals, 1), undefined);
  assertEquals(keyedAt(normals, 3), undefined);
  for (const [key, frames] of [[0, 3], [2, 4], [7, 1]] as const) {
    const move = keyedAt(normals, key);
    assertTrue(isRecord(move) && move.frames === frames);
  }
  const first = keyedAt(normals, 0);
  const poses = isRecord(first) ? first.poses : undefined;
  assertEquals(keyedAt(poses, -2), 15);
  assertEquals(keyedAt(poses, 0), 7);
  assertEquals(keyedAt(poses, 5), 9);
  assertEquals(keyedAt(poses, 1), undefined);
  const list = back.list;
  const row = Array.isArray(list) ? list[0] : undefined;
  const throws = isRecord(row) ? row.throws : undefined;
  assertEquals(keyedAt(throws, -1), "back");
  assertEquals(keyedAt(throws, 3), "up");
  assertEquals(keyedAt(throws, 2), undefined);
  const plain = back.plain;
  assertTrue(Array.isArray(plain) && plain[0] === 10 && plain[2] === 30 && plain.length === 3);
});


function thrown(record: object, keyed: readonly string[] = []): string | undefined {
  try {
    recordTokens(record, keyed);
  } catch (error) {
    return error instanceof IntegerKeysUndeclared ? error.message : `not IntegerKeysUndeclared: ${String(error)}`;
  }
  return undefined;
}

test("[spec #25] record text: a record keyed by numbers that isn't declared throws, naming its path", () => {
  const moves: Record<number, number> = {};
  moves[0] = 1;
  moves[2] = 3;
  const message = thrown({ kit: { rows: [{ name: "jab" }, { moves }] } });
  assertEquals(message?.startsWith("record text: kit.rows.1.moves is keyed by integers but not declared"), true, message);
  assertEquals(thrown({ moves: { jab: 1 } }, ["moves"])?.startsWith("record text: moves is declared keyed by integers"), true);
});

const COUNTER: Repro["lines"] = ["start 3", "add 4 5"];


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

test("[invariant] repro: its lines name the build, frame and checksum, and a replay must reach that checksum", () => {
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
