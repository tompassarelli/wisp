// The payload checksum of a Lua string, as checksum() in
// wisp:src/runtime/payload.ts computes it over the same bytes. Reading
// eight bytes per string.byte call halves its cost in Warcraft's Lua, where a
// bundle of about a megabyte is checked before every reload.
import { floorMod } from "../sim/intMath";

const FIRST = 8165329;
const SECOND = 8165323;
// Lua's string.byte, typed for the two ways this module calls it.
declare namespace string {
  function byte(text: string, position: number): number;
  function byte(text: string, first: number, last: number): LuaMultiReturn<[number, number, number, number, number, number, number, number]>;
}

export function stringChecksum(text: string): string {
  let first = 0;
  let second = 0;
  const length = text.length;
  let position = 1;
  for (; position + 7 <= length; position += 8) {
    const [b1, b2, b3, b4, b5, b6, b7, b8] = string.byte(text, position, position + 7);
    first = floorMod(first * 257 + b1 + 1, FIRST);
    second = floorMod(second * 263 + b1 + 1, SECOND);
    first = floorMod(first * 257 + b2 + 1, FIRST);
    second = floorMod(second * 263 + b2 + 1, SECOND);
    first = floorMod(first * 257 + b3 + 1, FIRST);
    second = floorMod(second * 263 + b3 + 1, SECOND);
    first = floorMod(first * 257 + b4 + 1, FIRST);
    second = floorMod(second * 263 + b4 + 1, SECOND);
    first = floorMod(first * 257 + b5 + 1, FIRST);
    second = floorMod(second * 263 + b5 + 1, SECOND);
    first = floorMod(first * 257 + b6 + 1, FIRST);
    second = floorMod(second * 263 + b6 + 1, SECOND);
    first = floorMod(first * 257 + b7 + 1, FIRST);
    second = floorMod(second * 263 + b7 + 1, SECOND);
    first = floorMod(first * 257 + b8 + 1, FIRST);
    second = floorMod(second * 263 + b8 + 1, SECOND);
  }
  for (; position <= length; position++) {
    const byte = string.byte(text, position);
    first = floorMod(first * 257 + byte + 1, FIRST);
    second = floorMod(second * 263 + byte + 1, SECOND);
  }
  return `${first}:${second}`;
}
