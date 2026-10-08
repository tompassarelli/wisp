// Rounds a real result to binary32 (Math.fround on the host). Warcraft's Lua
// numbers are binary32, but its raw arithmetic doesn't round to nearest: a
// product can land an ulp toward zero, and a quotient an ulp away from the
// nearest (smashcraft's native camera, 7 October 2026). So the
// warcraft-numbers plugin compiles f32(a + b), f32(a - b), f32(a * b) and
// f32(a / b) to calls of __wispF32Add, __wispF32Subtract, __wispF32Multiply
// and __wispF32Divide, which round the exact result to nearest: a sum or
// difference of magnitudes in [2^-16, 2^16) from integer significands, other
// operations with the binary32 helpers. Any other f32(x) compiles to x, which
// is already binary32 there.
import { addFloat32, divideFloat32, multiplyFloat32, subtractFloat32 } from "./binary32";
import { floorDiv } from "./intMath";

// The slow path's cache keys an operation by these.
const ADD = 1;
const SUBTRACT = 2;
const MULTIPLY = 3;
const DIVIDE = 4;

/** Integers up to 2^24 are binary32 values, so arithmetic that stays within it is exact under any rounding. */
const EXACT_INTEGERS = 16777216;
/** 2^-100: from there up, the difference of two values within a factor of two of each other is a normal number. */
const STERBENZ_FLOOR = 7.888609052210118e-31;

const cachedLeft: number[] = [];
const cachedRight: number[] = [];
const cachedOperation: number[] = [];
const cachedResult: number[] = [];
for (let i = 0; i < 8192; i++) {
  cachedLeft.push(0);
  cachedRight.push(0);
  cachedOperation.push(0);
  cachedResult.push(0);
}

function slowFloat32(left: number, right: number, operation: number): number {
  // Zero signs and nonfinite values bypass equality keys. The hash uses exact
  // power-of-two scaling and integer arithmetic below Warcraft's signed limit.
  let index = -1;
  if (left !== 0 && right !== 0 && left >= -32768 && left <= 32768 && right >= -32768 && right <= 32768) {
    index = (floorDiv(left * 256.0, 1) ^ (floorDiv(right * 256.0, 1) * 31) ^ (operation * 131)) & 8191;
    if (cachedLeft[index] === left && cachedRight[index] === right && cachedOperation[index] === operation) {
      return cachedResult[index] ?? 0;
    }
  }
  const result = operation === MULTIPLY ? multiplyFloat32(left, right)
    : operation === DIVIDE ? divideFloat32(left, right)
    : operation === SUBTRACT ? subtractFloat32(left, right) : addFloat32(left, right);
  if (index >= 0) {
    cachedLeft[index] = left;
    cachedRight[index] = right;
    cachedOperation[index] = operation;
    cachedResult[index] = result;
  }
  return result;
}

/** A sum or difference whose larger operand is outside [2^-16, 2^16), NaN or infinite. */
function outsideSumRange(value: number, right: number, operation: number): number {
  // Sterbenz: subtracting a same-signed value within a factor of two is exact.
  const subtrahend = operation === SUBTRACT ? right : -right;
  if (
    value > 0
      ? subtrahend > 0 && value >= STERBENZ_FLOOR && value < EXACT_INTEGERS && subtrahend <= value * 2.0 && value <= subtrahend * 2.0
      : subtrahend < 0 && value <= -STERBENZ_FLOOR && value > -EXACT_INTEGERS && subtrahend >= value * 2.0 && value >= subtrahend * 2.0
  ) {
    return operation === SUBTRACT ? value - right : value + right;
  }
  return slowFloat32(value, right, operation);
}

/**
 * value + addend rounded once, for nonzero operands that aren't both small
 * integers; `operation` and the operand it negated name the operation for the
 * limb helpers. The larger magnitude, big, scaled by a power of two to an
 * integer in [2^23, 2^24), and the smaller by the same power, whose fraction
 * below one unit decides the rounding. Scaling by powers of two, floor and
 * integer arithmetic are exact under any rounding; NaN and infinities take
 * the limb helpers.
 */
function sum(value: number, addend: number, operation: number): number {
  const valueNegative = value < 0;
  const addendNegative = addend < 0;
  let big = valueNegative ? -value : value;
  let small = addendNegative ? -addend : addend;
  let negative = valueNegative;
  if (!(small <= big)) {
    const larger = small;
    small = big;
    big = larger;
    negative = addendNegative;
  }
  // Five comparisons find e, 2^e <= big < 2^(e + 1), for e in [-16, 15]:
  // up = 2^(23 - e) and down = 2^(e - 23).
  let up: number;
  let down: number;
  if (big < 1.0) {
    if (big < 0.00390625) {
      if (big < 0.000244140625) {
        if (big < 0.00006103515625) {
          if (big < 0.000030517578125) {
            if (big < 0.0000152587890625) return outsideSumRange(value, operation === SUBTRACT ? -addend : addend, operation);
            up = 549755813888.0;
            down = 1.8189894035458565e-12;
          } else {
            up = 274877906944.0;
            down = 3.637978807091713e-12;
          }
        } else {
          if (big < 0.0001220703125) {
            up = 137438953472.0;
            down = 7.275957614183426e-12;
          } else {
            up = 68719476736.0;
            down = 1.4551915228366852e-11;
          }
        }
      } else {
        if (big < 0.0009765625) {
          if (big < 0.00048828125) {
            up = 34359738368.0;
            down = 2.9103830456733704e-11;
          } else {
            up = 17179869184.0;
            down = 5.820766091346741e-11;
          }
        } else {
          if (big < 0.001953125) {
            up = 8589934592.0;
            down = 1.1641532182693481e-10;
          } else {
            up = 4294967296.0;
            down = 2.3283064365386963e-10;
          }
        }
      }
    } else {
      if (big < 0.0625) {
        if (big < 0.015625) {
          if (big < 0.0078125) {
            up = 2147483648.0;
            down = 4.656612873077393e-10;
          } else {
            up = 1073741824.0;
            down = 9.313225746154785e-10;
          }
        } else {
          if (big < 0.03125) {
            up = 536870912.0;
            down = 1.862645149230957e-9;
          } else {
            up = 268435456.0;
            down = 3.725290298461914e-9;
          }
        }
      } else {
        if (big < 0.25) {
          if (big < 0.125) {
            up = 134217728.0;
            down = 7.450580596923828e-9;
          } else {
            up = 67108864.0;
            down = 1.4901161193847656e-8;
          }
        } else {
          if (big < 0.5) {
            up = 33554432.0;
            down = 2.9802322387695312e-8;
          } else {
            up = 16777216.0;
            down = 5.960464477539063e-8;
          }
        }
      }
    }
  } else {
    if (big < 256.0) {
      if (big < 16.0) {
        if (big < 4.0) {
          if (big < 2.0) {
            up = 8388608.0;
            down = 1.1920928955078125e-7;
          } else {
            up = 4194304.0;
            down = 2.384185791015625e-7;
          }
        } else {
          if (big < 8.0) {
            up = 2097152.0;
            down = 4.76837158203125e-7;
          } else {
            up = 1048576.0;
            down = 9.5367431640625e-7;
          }
        }
      } else {
        if (big < 64.0) {
          if (big < 32.0) {
            up = 524288.0;
            down = 0.0000019073486328125;
          } else {
            up = 262144.0;
            down = 0.000003814697265625;
          }
        } else {
          if (big < 128.0) {
            up = 131072.0;
            down = 0.00000762939453125;
          } else {
            up = 65536.0;
            down = 0.0000152587890625;
          }
        }
      }
    } else {
      if (big < 4096.0) {
        if (big < 1024.0) {
          if (big < 512.0) {
            up = 32768.0;
            down = 0.000030517578125;
          } else {
            up = 16384.0;
            down = 0.00006103515625;
          }
        } else {
          if (big < 2048.0) {
            up = 8192.0;
            down = 0.0001220703125;
          } else {
            up = 4096.0;
            down = 0.000244140625;
          }
        }
      } else {
        if (big < 16384.0) {
          if (big < 8192.0) {
            up = 2048.0;
            down = 0.00048828125;
          } else {
            up = 1024.0;
            down = 0.0009765625;
          }
        } else {
          if (big < 32768.0) {
            up = 512.0;
            down = 0.001953125;
          } else {
            if (!(big < 65536.0)) return outsideSumRange(value, operation === SUBTRACT ? -addend : addend, operation);
            up = 256.0;
            down = 0.00390625;
          }
        }
      }
    }
  }
  const scaledBig = big * up;
  const scaledSmall = small * up;
  // Less than a quarter unit never moves big off its nearest value.
  if (scaledSmall < 0.25) return negative ? -(scaledBig * down) : scaledBig * down;
  const whole = floorDiv(scaledSmall, 1);
  const fraction = scaledSmall - whole;
  const bigUnits = scaledBig | 0;
  const smallUnits = whole | 0;
  let units: number;
  if (valueNegative === addendNegative) {
    units = bigUnits + smallUnits;
    if (units < 16777216) {
      if (fraction > 0.5 || (fraction === 0.5 && (units & 1) === 1)) units += 1;
    } else if ((units & 1) === 1) {
      // From 2^24 the result counts in twos: an odd unit plus the fraction is
      // past the half unless the fraction is zero, a tie that keeps the even half.
      units += fraction > 0 || (units & 2) === 2 ? 1 : -1;
    }
  } else if (fraction === 0) {
    units = bigUnits - smallUnits;
    if (units === 0) return 0.0;
  } else {
    // big - small = units + (1 - fraction).
    units = bigUnits - smallUnits - 1;
    if (units >= 8388608) {
      if (fraction < 0.5 || (fraction === 0.5 && (units & 1) === 1)) units += 1;
    } else if (units >= 4194304) {
      // Below 2^23 the result counts in halves: 1 - fraction rounds to 0, 1/2 or 1.
      units = units * 2 + (fraction <= 0.25 ? 2 : fraction < 0.75 ? 1 : 0);
      return negative ? -(units * down * 0.5) : units * down * 0.5;
    } else {
      // small > big / 2, so the difference is exact (Sterbenz).
      return negative ? small - big : big - small;
    }
  }
  return negative ? -(units * down) : units * down;
}

// One function per operation, so a call names its operation instead of
// passing a code each would test. Results exact under any rounding take Lua's
// raw operator; the integer tests are inline, as floorDiv(x, 1) is Lua's
// x // 1, without a call.

/** f32(a + b) in Lua. */
export function exactSum(value: number, right: number): number {
  if (value === 0 || right === 0) return value + right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -16777216 && value <= 16777216 && right >= -16777216 && right <= 16777216) {
    const total = value + right;
    if (total > -16777216 && total < 16777216) return total;
  }
  return sum(value, right, ADD);
}

/** f32(a - b) in Lua: the sum with b negated, which is exact; the integer -2^31 has no negation. */
export function exactDifference(value: number, right: number): number {
  if (value === 0 || right === 0) return value - right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -16777216 && value <= 16777216 && right >= -16777216 && right <= 16777216) {
    const difference = value - right;
    if (difference > -16777216 && difference < 16777216) return difference;
  }
  return right === -2147483648 ? outsideSumRange(value, right, SUBTRACT) : sum(value, -right, SUBTRACT);
}

/** f32(a * b) in Lua. */
export function exactProduct(value: number, right: number): number {
  // Zeros keep their IEEE signs; small integers keep Lua's integer type.
  if (value === 0 || right === 0) return value * right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -4096 && value <= 4096 && right >= -4096 && right <= 4096) return value * right;
  // A product with ±1 is exact; * 1.0 keeps the float the helper would return.
  if (right === 1 || right === -1 || value === 1 || value === -1) return value * right * 1.0;
  return slowFloat32(value, right, MULTIPLY);
}

/** f32(a / b) in Lua. */
export function exactQuotient(value: number, right: number): number {
  // A zero numerator keeps its IEEE sign; integers that divide evenly give an integer within 2^24. Both are exact under any rounding.
  if (value === 0 || right === 0) return value / right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -EXACT_INTEGERS && value <= EXACT_INTEGERS) {
    const quotient = floorDiv(value, right);
    if (quotient * right === value) return quotient * 1.0;
  }
  return slowFloat32(value, right, DIVIDE);
}

declare global {
  /** The operations f32(a + b), f32(a - b), f32(a * b) and f32(a / b) compile to in Lua (wisp:plugins/warcraft-numbers.ts). */
  var __wispF32Add: (value: number, right: number) => number;
  var __wispF32Subtract: (value: number, right: number) => number;
  var __wispF32Multiply: (value: number, right: number) => number;
  var __wispF32Divide: (value: number, right: number) => number;
}
globalThis.__wispF32Add = exactSum;
globalThis.__wispF32Subtract = exactDifference;
globalThis.__wispF32Multiply = exactProduct;
globalThis.__wispF32Divide = exactQuotient;

/** Binary32 rounding: Math.fround on the host; the compiler removes it in Lua, whose numbers are binary32. */
export function f32(value: number): number {
  return Math.fround(value);
}
