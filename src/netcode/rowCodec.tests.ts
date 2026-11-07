import { at } from "../runtime/lookup";
import { assertEquals, assertTrue, test } from "../runtime/testing";
import { floorMod } from "../sim/intMath";
import type { RowCodec } from "./codec";
import { MESSAGE_MAX_BYTES, MESSAGE_MAX_FRAMES, decodeMessage, encodeMessage } from "./message";
import { type WireReader, digit, readDigit, readSignedVarint, readVarint, signedVarint, varint } from "./wire";

export interface ToyRow {
  move: number;
  fire: number;
  aim: number;
}

export const TOY_AIM = 5000;
export const TOY_FIRE = 15;
const MOVE = 1;
const FIRE = 2;

export function toyRow(): ToyRow {
  return { move: 0, fire: 0, aim: 0 };
}

export const TOY_CODEC: RowCodec<ToyRow> = {
  neutral: toyRow,
  copy: (target, source) => {
    target.move = source.move;
    target.fire = source.fire;
    target.aim = source.aim;
  },
  same: (a, b) => a.move === b.move && a.fire === b.fire && a.aim === b.aim,
  hold: (target, previous) => {
    target.move = previous.move;
    target.fire = 0;
    target.aim = 0;
  },
  urgent: (row) => row.fire !== 0,
  write: (row, previous) => {
    const move = row.move !== previous.move;
    const fire = row.fire !== 0;
    let text = digit((move ? MOVE : 0) | (fire ? FIRE : 0));
    if (move) text += digit(row.move);
    if (fire) text += varint(row.fire) + signedVarint(row.aim);
    return text;
  },
  read: (reader: WireReader, previous, target) => {
    const flags = readDigit(reader);
    if (flags === undefined || flags > (MOVE | FIRE)) return false;
    const move = (flags & MOVE) !== 0 ? readDigit(reader) : previous.move;
    const fire = (flags & FIRE) !== 0 ? readVarint(reader, TOY_FIRE) : 0;
    const aim = (flags & FIRE) !== 0 ? readSignedVarint(reader, TOY_AIM) : 0;
    if (move === undefined || fire === undefined || aim === undefined) return false;
    if ((flags & MOVE) !== 0 && move === previous.move) return false;
    if ((flags & FIRE) !== 0 && fire === 0) return false;
    target.move = move;
    target.fire = fire;
    target.aim = aim;
    return move <= 15;
  },
};

export function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = floorMod(state * 75 + 74, 65537);
    return state;
  };
}

function randomRows(next: () => number, count: number, fireOdds: number): ToyRow[] {
  const rows: ToyRow[] = [];
  let move = 0;
  for (let index = 0; index < count; index++) {
    if (floorMod(next(), 4) === 0) move = floorMod(next(), 16);
    const fire = floorMod(next(), fireOdds) === 0 ? 1 + floorMod(next(), TOY_FIRE) : 0;
    const aim = fire === 0 ? 0 : floorMod(next() * 32 + next(), 2 * TOY_AIM + 1) - TOY_AIM;
    rows.push({ move, fire, aim });
  }
  return rows;
}

test("wire: varints and signed varints survive a round trip at their limits and reject a non-minimal or over-limit encoding", () => {
  for (const value of [0, 1, 31, 32, 1023, 1024, 33554431, 33554432, 2147483646]) {
    const reader = { text: varint(value), offset: 0 };
    assertEquals(readVarint(reader, 2147483646), value, `varint ${value}`);
    assertEquals(reader.offset, reader.text.length, `varint ${value} length`);
  }
  for (const value of [0, 1, -1, 5000, -5000, 1048576, -1048576]) {
    assertEquals(readSignedVarint({ text: signedVarint(value), offset: 0 }, 1048576), value, `signed varint ${value}`);
  }
  assertEquals(readVarint({ text: varint(33), offset: 0 }, 32), undefined, "over the limit");
  assertEquals(readVarint({ text: "w0", offset: 0 }, 2147483646), undefined, "a continuation digit then a zero payload");
  assertEquals(readVarint({ text: "!", offset: 0 }, 2147483646), undefined, "a character outside the alphabet");
  assertEquals(readVarint({ text: "w", offset: 0 }, 2147483646), undefined, "a varint cut short");
});
