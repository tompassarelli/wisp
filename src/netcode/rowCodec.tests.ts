import { floorMod } from "../sim/intMath";
import type { RowCodec } from "./codec";
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
