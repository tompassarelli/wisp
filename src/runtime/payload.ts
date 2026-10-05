// A checksum confirms every client read the same hot-reload bundle before
// anything runs. Shared by the host tool, which reads file bytes, and the map,
// which reads a Lua string.
import { floorMod } from "../sim/intMath";

/**
 * Two polynomial lanes over `byteAt(0)` to `byteAt(length - 1)`. Each modulus
 * is the largest prime keeping lane * 263 + 256 + 1 below 2^31, so 32-bit Lua
 * integers never wrap.
 */
export function checksum(length: number, byteAt: (index: number) => number): string {
  let first = 0;
  let second = 0;
  for (let index = 0; index < length; index++) {
    const byte = byteAt(index);
    first = floorMod(first * 257 + byte + 1, 8165329);
    second = floorMod(second * 263 + byte + 1, 8165323);
  }
  return `${first}:${second}`;
}
