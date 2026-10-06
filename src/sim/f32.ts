// Rounds a real result to binary32 (Math.fround on the host). Warcraft's Lua
// numbers are binary32, but its raw + and * don't round to nearest: a product
// can land an ulp toward zero. So the warcraft-numbers plugin compiles
// f32(a + b), f32(a - b) and f32(a * b) to f32(a, b, F32_ADD/SUBTRACT/MULTIPLY),
// which rounds the exact result to nearest with the binary32 helpers, and any
// other f32(x) to x: division rounds to nearest in Warcraft, and x is already
// binary32 there.
import { addFloat32, multiplyFloat32, subtractFloat32 } from "./binary32";

/** The operation codes the compiler passes as f32's third argument; no source writes them. */
export const F32_ADD = 1;
export const F32_SUBTRACT = 2;
export const F32_MULTIPLY = 3;

/** Integers up to 2^24 are binary32 values, so arithmetic that stays within it is exact under any rounding. */
const EXACT_INTEGERS = 16777216;
const integerWithin = (value: number, limit: number) => value === Math.floor(value) && value >= -limit && value <= limit;

export function f32(value: number, right?: number, operation?: number): number {
  if (right === undefined || typeof operation !== "number") return Math.fround(value);
  if (operation === F32_MULTIPLY) {
    // Zeros keep their IEEE signs; small integers keep Lua's integer type.
    if (value === 0 || right === 0 || (integerWithin(value, 4096) && integerWithin(right, 4096))) return value * right;
    return multiplyFloat32(value, right);
  }
  if (value === 0 || right === 0) return operation === F32_SUBTRACT ? value - right : value + right;
  if (integerWithin(value, EXACT_INTEGERS) && integerWithin(right, EXACT_INTEGERS)) {
    const sum = operation === F32_SUBTRACT ? value - right : value + right;
    if (sum > -EXACT_INTEGERS && sum < EXACT_INTEGERS) return sum;
  }
  return operation === F32_SUBTRACT ? subtractFloat32(value, right) : addFloat32(value, right);
}
