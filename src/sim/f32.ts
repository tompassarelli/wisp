// Rounds a real result to binary32 (Math.fround on the host). Warcraft's Lua
// numbers are binary32, but its raw + and * don't round to nearest: a product
// can land an ulp toward zero. So the warcraft-numbers plugin compiles
// f32(a + b), f32(a - b) and f32(a * b) to f32(a, b, F32_ADD/SUBTRACT/MULTIPLY),
// which rounds the exact result to nearest with the binary32 helpers, and any
// other f32(x) to x: division rounds to nearest in Warcraft, and x is already
// binary32 there.
import { addFloat32, multiplyFloat32, subtractFloat32 } from "./binary32";
import { floorDiv } from "./intMath";

// Module locals: Lua reads an exported constant from the module table on every use.
const ADD = 1;
const SUBTRACT = 2;
const MULTIPLY = 3;

/** The operation codes the compiler passes as f32's third argument; no source writes them. */
export const F32_ADD = ADD;
export const F32_SUBTRACT = SUBTRACT;
export const F32_MULTIPLY = MULTIPLY;

/** Integers up to 2^24 are binary32 values, so arithmetic that stays within it is exact under any rounding. */
const EXACT_INTEGERS = 16777216;
/** 2^-100: from there up, the difference of two values within a factor of two of each other is a normal number. */
const STERBENZ_FLOOR = 7.888609052210118e-31;

// Every synchronized f32 operation runs this. Results exact under any
// rounding take Lua's raw operator; the integer tests are inline, as
// floorDiv(x, 1) is Lua's x // 1, without a call.
export function f32(value: number, right?: number, operation?: number): number {
  if (right === undefined || operation === undefined) return Math.fround(value);
  if (operation === MULTIPLY) {
    // Zeros keep their IEEE signs; small integers keep Lua's integer type.
    if (value === 0 || right === 0) return value * right;
    if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -4096 && value <= 4096 && right >= -4096 && right <= 4096) return value * right;
    // A product with ±1 is exact; * 1.0 keeps the float the helper would return.
    if (right === 1 || right === -1 || value === 1 || value === -1) return value * right * 1.0;
    return multiplyFloat32(value, right);
  }
  if (value === 0 || right === 0) return operation === SUBTRACT ? value - right : value + right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -EXACT_INTEGERS && value <= EXACT_INTEGERS && right >= -EXACT_INTEGERS && right <= EXACT_INTEGERS) {
    const sum = operation === SUBTRACT ? value - right : value + right;
    if (sum > -EXACT_INTEGERS && sum < EXACT_INTEGERS) return sum;
  }
  // Sterbenz: subtracting a same-signed value within a factor of two is exact.
  const subtrahend = operation === SUBTRACT ? right : -right;
  if (
    value > 0
      ? subtrahend > 0 && value >= STERBENZ_FLOOR && value < EXACT_INTEGERS && subtrahend <= value * 2.0 && value <= subtrahend * 2.0
      : subtrahend < 0 && value <= -STERBENZ_FLOOR && value > -EXACT_INTEGERS && subtrahend >= value * 2.0 && value >= subtrahend * 2.0
  ) {
    return operation === SUBTRACT ? value - right : value + right;
  }
  return operation === SUBTRACT ? subtractFloat32(value, right) : addFloat32(value, right);
}
