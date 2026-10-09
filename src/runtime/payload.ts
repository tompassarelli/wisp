


import { floorMod } from "../sim/intMath";

// Each modulus keeps lane * 263 + 256 + 1 below 2^31 so Lua32 integers never wrap.




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
