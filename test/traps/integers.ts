import { floorDiv, floorMod, idiv, imod } from "../../src/sim/intMath";

export function traps(a: number, b: number): number[] {
  let c = a;
  c %= 3; // rejected
  return [
    a % b, // rejected
    a >>> 1, // rejected
    Math.floor(a / b), // rejected
    Math.floor((a / b)), // rejected
    floorDiv(a, b),
    floorMod(a, b),
    idiv(a, b),
    imod(a, b),
    Math.floor(a),
    a & b,
    c,
  ];
}
