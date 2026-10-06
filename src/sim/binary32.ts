// IEEE 754 binary32 arithmetic, ported from the Binary32 package of
// tompassarelli/WurstStdlib2 (e3714f6). Every operation rounds once, to nearest
// with ties to even, on binary64 hosts and in Warcraft's binary32 Lua alike.
// Integer limbs stay below 2^31, the range of Warcraft's Lua integers.
//
// Warcraft's float + and * don't round to nearest, so these use only integer
// arithmetic, comparisons and scaling by powers of two. Rollback replays run
// thousands of them a callback, so the operations whose result is a normal
// number allocate nothing; subnormal, infinite and non-finite cases take the
// limb implementation below them.
import { at } from "../runtime/lookup";
import { floorDiv, floorMod } from "./intMath";

// Scaling by a power of two is exact, so large steps reach the same value as
// single ones with a fraction of the work.
const TWO_POWERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864, 134217728, 268435456, 536870912, 1073741824];

/** Truncation toward zero, which Lua and JavaScript both emit exactly. */
export function toInt(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function binary32Infinity(): number {
  // 2^(24 * 64) overflows binary32 and binary64 without dividing by zero.
  let result = 16777216.0;
  for (let i = 1; i <= 6; i++) result *= result;
  return result;
}

const INFINITY = binary32Infinity();
const SIGNIFICAND_UNIT = 1.1920928955078125e-7;

/** 2^-126 through 2^127, the normal powers of two: element i is 2^(i - 126). */
const NORMAL_POWERS: number[] = [];
{
  let power = 1.0;
  for (let i = 0; i < 126; i++) power *= 0.5;
  NORMAL_POWERS.push(power);
  for (let i = 1; i < 254; i++) {
    power *= 2.0;
    NORMAL_POWERS.push(power);
  }
}
const SMALLEST_NORMAL = at(NORMAL_POWERS, 0);

/** significand * 2^exponent for a significand in [2^23, 2^24); undefined unless the result is a normal binary32 value. */
function normalResult(significand: number, exponent: number, negative: boolean): number | undefined {
  const power = NORMAL_POWERS[exponent + 149];
  if (power === undefined) return undefined;
  const magnitude = significand * SIGNIFICAND_UNIT * power;
  return negative ? -magnitude : magnitude;
}

/** Rounds to the nearest binary32 value; NaN and infinity pass through. */
export function roundToFloat32(value: number): number {
  // A normal-range number is already binary32 in Lua; Math.fround rounds it on
  // the host. (f32 imports this module, so it can't be used here.)
  if ((value >= SMALLEST_NORMAL && value < INFINITY) || (value <= -SMALLEST_NORMAL && value > -INFINITY)) return Math.fround(value * 1.0);
  if (value === 0 || value !== value) return value;
  const negative = value < 0;
  let significand = negative ? -value : value;
  let scale = 1.0;
  let exponent = 0;
  while (significand >= 65536 && exponent <= 111) {
    significand *= 0.0000152587890625;
    scale *= 65536;
    exponent += 16;
  }
  while (significand >= 16 && exponent <= 123) {
    significand *= 0.0625;
    scale *= 16;
    exponent += 4;
  }
  while (significand >= 2 && exponent < 127) {
    significand *= 0.5;
    scale *= 2;
    exponent += 1;
  }
  if (significand >= 2) return negative ? -INFINITY : INFINITY;
  while (significand < 0.0000152587890625 && exponent >= -110) {
    significand *= 65536;
    scale *= 0.0000152587890625;
    exponent -= 16;
  }
  while (significand < 0.0625 && exponent >= -122) {
    significand *= 16;
    scale *= 0.0625;
    exponent -= 4;
  }
  while (significand < 1 && exponent > -126) {
    significand *= 2;
    scale *= 0.5;
    exponent -= 1;
  }
  const units = significand * 8388608.0;
  let rounded = Math.floor(units);
  const remainder = units - rounded;
  if (remainder > 0.5 || (remainder === 0.5 && floorMod(rounded, 2) !== 0)) rounded += 1;
  if (exponent === 127 && rounded === 16777216) {
    return negative ? -INFINITY : INFINITY;
  }
  const result = (rounded / 8388608.0) * scale;
  return negative ? -result : result;
}

// The last split: |value| truncated to 24 bits is splitSignificand * 2^splitExponent,
// with splitSignificand in [2^23, 2^24).
let splitSignificand = 0;
let splitExponent = 0;

/** Sets splitSignificand and splitExponent from a finite nonzero value. */
function split(value: number): void {
  // Halving steps of 8, 4, 2 and 1 bits reach [1, 2) from any game-scale magnitude in a few comparisons.
  let normalized = value < 0 ? -value : value;
  let exponent = -23;
  if (normalized >= 2) {
    while (normalized >= 65536) {
      normalized *= 0.0000152587890625;
      exponent += 16;
    }
    if (normalized >= 256) {
      normalized *= 0.00390625;
      exponent += 8;
    }
    if (normalized >= 16) {
      normalized *= 0.0625;
      exponent += 4;
    }
    if (normalized >= 4) {
      normalized *= 0.25;
      exponent += 2;
    }
    if (normalized >= 2) {
      normalized *= 0.5;
      exponent += 1;
    }
  } else if (normalized < 1) {
    while (normalized < 0.0000152587890625) {
      normalized *= 65536;
      exponent -= 16;
    }
    if (normalized < 0.00390625) {
      normalized *= 256;
      exponent -= 8;
    }
    if (normalized < 0.0625) {
      normalized *= 16;
      exponent -= 4;
    }
    if (normalized < 0.25) {
      normalized *= 4;
      exponent -= 2;
    }
    if (normalized < 0.5) {
      normalized *= 2;
      exponent -= 1;
    }
    normalized *= 2;
    exponent -= 1;
  }
  splitSignificand = (normalized * 8388608.0) | 0;
  splitExponent = exponent;
}

/**
 * Rounds (high * 2^24 + low) * 2^exponent, plus a fraction of 2^exponent in
 * (0, 1) when sticky, to 24 bits. Requires 0 < high < 2^31 or 0 < low, and
 * 0 <= low < 2^24; with sticky, high >= 2^23 - 1.
 */
function roundLimbsToNormal(high: number, low: number, exponent: number, sticky: boolean, negative: boolean): number | undefined {
  let top = high;
  let bottom = low;
  let scale = exponent;
  let inexact = sticky;
  while (top >= 16777216) {
    if (floorMod(bottom, 2) !== 0) inexact = true;
    bottom = floorDiv(bottom, 2) + floorMod(top, 2) * 8388608;
    top = floorDiv(top, 2);
    scale += 1;
  }
  let significand: number;
  let remainder: number;
  let half: number;
  if (top >= 8388608) {
    significand = top;
    remainder = bottom;
    half = 8388608;
    scale += 24;
  } else if (inexact) {
    significand = top * 2 + floorDiv(bottom, 8388608);
    remainder = floorMod(bottom, 8388608);
    half = 4194304;
    scale += 23;
  } else {
    // Exact: shifting left loses nothing.
    if (top === 0) {
      top = bottom;
      bottom = 0;
      scale -= 24;
    }
    while (top < 8388608) {
      top = top * 2 + floorDiv(bottom, 8388608);
      bottom = floorMod(bottom, 8388608) * 2;
      scale -= 1;
    }
    significand = top;
    remainder = bottom;
    half = 8388608;
    scale += 24;
  }
  if (remainder > half || (remainder === half && (inexact || floorMod(significand, 2) !== 0))) {
    significand += 1;
    if (significand === 16777216) {
      significand = 8388608;
      scale += 1;
    }
  }
  return normalResult(significand, scale, negative);
}

/**
 * (high * 2^24 + low) * 2^exponent, with high in [2^23, 2^24), plus c, rounded
 * once; undefined unless the result is a normal binary32 value.
 */
function addToLimbs(high: number, low: number, exponent: number, negative: boolean, c: number): number | undefined {
  split(c);
  const addend = splitSignificand;
  const addendNegative = c < 0;
  // Bits from the low limb's lowest bit to the addend's.
  const shift = splitExponent - exponent;
  if (shift > 30) {
    // The addend dominates: six guard bits below it and a sticky bit for the rest.
    const guarded = splitExponent - 6;
    let part = 0;
    let sticky = true;
    if (shift - 30 < 24) {
      const unit = TWO_POWERS[shift - 30] ?? 0;
      part = floorDiv(high, unit);
      sticky = high - part * unit !== 0 || low !== 0;
    }
    let sum = addend * 64;
    if (negative === addendNegative) sum += part;
    else sum -= part + (sticky ? 1 : 0);
    // sum is in (2^28, 2^31): drop five to seven bits.
    const dropped = sum >= 1073741824 ? 7 : sum >= 536870912 ? 6 : 5;
    const unit = TWO_POWERS[dropped] ?? 0;
    let significand = floorDiv(sum, unit);
    const remainder = sum - significand * unit;
    const half = TWO_POWERS[dropped - 1] ?? 0;
    let scale = guarded + dropped;
    if (remainder > half || (remainder === half && (sticky || floorMod(significand, 2) !== 0))) {
      significand += 1;
      if (significand === 16777216) {
        significand = 8388608;
        scale += 1;
      }
    }
    return normalResult(significand, scale, addendNegative);
  }
  let top = high;
  let bottom = low;
  let sign = negative;
  if (shift < 0) {
    // The addend sits below the low limb: a sticky bit keeps what shifts out.
    let part = 0;
    let sticky = true;
    if (-shift < 24) {
      const unit = TWO_POWERS[-shift] ?? 0;
      part = floorDiv(addend, unit);
      sticky = addend - part * unit !== 0;
    }
    if (negative === addendNegative) {
      bottom += part;
      if (bottom >= 16777216) {
        bottom -= 16777216;
        top += 1;
      }
    } else {
      bottom -= part + (sticky ? 1 : 0);
      if (bottom < 0) {
        bottom += 16777216;
        top -= 1;
      }
    }
    return roundLimbsToNormal(top, bottom, exponent, sticky, sign);
  }
  // The addend's bits land on the two limbs exactly.
  let addendHigh: number;
  let addendLow = 0;
  if (shift >= 24) {
    addendHigh = addend * (TWO_POWERS[shift - 24] ?? 0);
  } else {
    const unit = TWO_POWERS[24 - shift] ?? 0;
    addendHigh = floorDiv(addend, unit);
    addendLow = (addend - addendHigh * unit) * (TWO_POWERS[shift] ?? 0);
  }
  if (negative === addendNegative) {
    top += addendHigh;
    bottom += addendLow;
    if (bottom >= 16777216) {
      bottom -= 16777216;
      top += 1;
    }
  } else {
    top -= addendHigh;
    bottom -= addendLow;
    if (bottom < 0) {
      bottom += 16777216;
      top -= 1;
    }
    if (top < 0) {
      if (bottom > 0) {
        top = -top - 1;
        bottom = 16777216 - bottom;
      } else {
        top = -top;
      }
      sign = addendNegative;
    } else if (top === 0 && bottom === 0) {
      return 0.0;
    }
  }
  return roundLimbsToNormal(top, bottom, exponent, false, sign);
}

/**
 * The exact sum of two split values rounded once; undefined unless it is a
 * normal binary32 value. The sum is an integer below 2^31 in units of its
 * lowest kept bit, with a sticky bit for what shifts out of the smaller
 * operand; rounding is inline, as every f32 sum and difference runs it.
 */
function sumOfSplits(aSignificand: number, aExponent: number, aNegative: boolean, bSignificand: number, bExponent: number, bNegative: boolean): number | undefined {
  // Order by magnitude: the result takes the larger operand's sign.
  let large = aSignificand;
  let largeExponent = aExponent;
  let negative = aNegative;
  let small = bSignificand;
  let smallExponent = bExponent;
  if (aExponent < bExponent || (aExponent === bExponent && aSignificand < bSignificand)) {
    large = bSignificand;
    largeExponent = bExponent;
    negative = bNegative;
    small = aSignificand;
    smallExponent = aExponent;
  }
  const same = aNegative === bNegative;
  const shift = largeExponent - smallExponent;
  let sum: number;
  let exponent: number;
  let sticky = false;
  if (shift <= 6) {
    // Both in units of the smaller one's lowest bit: exact below 2^31.
    const scaled = large * (TWO_POWERS[shift] ?? 0);
    sum = same ? scaled + small : scaled - small;
    if (sum === 0) return 0.0;
    exponent = smallExponent;
  } else if (shift > 30) {
    // The smaller is below a quarter of the larger's last place.
    return normalResult(large, largeExponent, negative);
  } else {
    // Six guard bits below the larger one; sum is then in (2^28, 2^31).
    const unit = TWO_POWERS[shift - 6] ?? 0;
    const part = floorDiv(small, unit);
    sticky = small - part * unit !== 0;
    sum = same ? large * 64 + part : large * 64 - part - (sticky ? 1 : 0);
    exponent = largeExponent - 6;
  }
  let significand = sum;
  if (sum < 16777216) {
    // Without a sticky bit: exact, and shifting left loses nothing.
    while (significand < 8388608) {
      significand *= 2;
      exponent -= 1;
    }
  } else {
    // Bits below the 24 kept: one to seven.
    let dropped: number;
    if (sum >= 134217728) dropped = sum >= 1073741824 ? 7 : sum >= 536870912 ? 6 : sum >= 268435456 ? 5 : 4;
    else dropped = sum >= 67108864 ? 3 : sum >= 33554432 ? 2 : 1;
    const unit = TWO_POWERS[dropped] ?? 0;
    significand = floorDiv(sum, unit);
    const remainder = sum - significand * unit;
    const half = TWO_POWERS[dropped - 1] ?? 0;
    exponent += dropped;
    if (remainder > half || (remainder === half && (sticky || floorMod(significand, 2) !== 0))) {
      significand += 1;
      if (significand === 16777216) {
        significand = 8388608;
        exponent += 1;
      }
    }
  }
  const power = NORMAL_POWERS[exponent + 149];
  if (power === undefined) return undefined;
  const magnitude = significand * SIGNIFICAND_UNIT * power;
  return negative ? -magnitude : magnitude;
}

export function addFloat32(a: number, b: number): number {
  if (a === 0) return 1.0 * a + b;
  if (a < INFINITY && a > -INFINITY && b < INFINITY && b > -INFINITY) {
    split(a);
    let result: number | undefined;
    if (b === 0) result = normalResult(splitSignificand, splitExponent, a < 0);
    else {
      const significand = splitSignificand;
      const exponent = splitExponent;
      split(b);
      result = sumOfSplits(significand, exponent, a < 0, splitSignificand, splitExponent, b < 0);
    }
    if (result !== undefined) return result;
  }
  return limbFusedMultiplyAdd(1.0, a, b);
}

export function subtractFloat32(a: number, b: number): number {
  if (b === 0) return -1.0 * b + a;
  if (a < INFINITY && a > -INFINITY && b < INFINITY && b > -INFINITY) {
    split(b);
    let result: number | undefined;
    if (a === 0) result = normalResult(splitSignificand, splitExponent, !(b < 0));
    else {
      const significand = splitSignificand;
      const exponent = splitExponent;
      split(a);
      result = sumOfSplits(splitSignificand, splitExponent, a < 0, significand, exponent, !(b < 0));
    }
    if (result !== undefined) return result;
  }
  return limbFusedMultiplyAdd(-1.0, b, a);
}

// The last product: (productHigh * 2^24 + productLow) * 2^productExponent is the
// exact product of two split values, with productHigh in [2^23, 2^24).
let productHigh = 0;
let productLow = 0;
let productExponent = 0;

/** Sets the product limbs of two finite nonzero values. */
function multiplySplit(a: number, b: number): void {
  split(a);
  const left = splitSignificand;
  const leftExponent = splitExponent;
  split(b);
  // Twelve-bit factors keep every partial product within signed 32 bits.
  const leftHigh = floorDiv(left, 4096);
  const leftLow = left - leftHigh * 4096;
  const rightHigh = floorDiv(splitSignificand, 4096);
  const rightLow = splitSignificand - rightHigh * 4096;
  const lowest = leftLow * rightLow;
  const middle = floorDiv(lowest, 4096) + leftHigh * rightLow + leftLow * rightHigh;
  let high = leftHigh * rightHigh + floorDiv(middle, 4096);
  let low = floorMod(lowest, 4096) + floorMod(middle, 4096) * 4096;
  let exponent = leftExponent + splitExponent;
  if (high < 8388608) {
    high = high * 2 + floorDiv(low, 8388608);
    low = floorMod(low, 8388608) * 2;
    exponent -= 1;
  }
  productHigh = high;
  productLow = low;
  productExponent = exponent;
}

export function multiplyFloat32(a: number, b: number): number {
  if (a === 0 || b === 0) return a * b + 0.0;
  if (a < INFINITY && a > -INFINITY && b < INFINITY && b > -INFINITY) {
    multiplySplit(a, b);
    let significand = productHigh;
    let exponent = productExponent + 24;
    if (productLow > 8388608 || (productLow === 8388608 && floorMod(significand, 2) !== 0)) {
      significand += 1;
      if (significand === 16777216) {
        significand = 8388608;
        exponent += 1;
      }
    }
    const result = normalResult(significand, exponent, a < 0 !== b < 0);
    if (result !== undefined) return result;
  }
  return limbFusedMultiplyAdd(a, b, 0.0);
}

/**
 * a * b + c with one binary32 rounding. Inputs must be finite binary32 values;
 * the exact product may leave binary32 range before cancellation.
 */
export function fusedMultiplyAddFloat32(a: number, b: number, c: number): number {
  if (a === 0 || b === 0) return a * b + c;
  if (a < INFINITY && a > -INFINITY && b < INFINITY && b > -INFINITY && c < INFINITY && c > -INFINITY) {
    multiplySplit(a, b);
    const negative = a < 0 !== b < 0;
    let result: number | undefined;
    if (c === 0) result = roundLimbsToNormal(productHigh, productLow, productExponent, false, negative);
    else result = addToLimbs(productHigh, productLow, productExponent, negative, c);
    if (result !== undefined) return result;
  }
  return limbFusedMultiplyAdd(a, b, c);
}

/** Long division keeps the quotient and sticky remainder; a zero divisor gives NaN. */
export function divideFloat32(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return INFINITY - INFINITY;
  }
  if (numerator === 0) return numerator;
  split(numerator);
  let remainder = splitSignificand;
  let exponent = splitExponent;
  split(denominator);
  const denominatorSignificand = splitSignificand;
  exponent -= splitExponent;
  const negative = numerator < 0 !== denominator < 0;
  if (remainder < denominatorSignificand) {
    remainder *= 2;
    exponent -= 1;
  }
  remainder -= denominatorSignificand;
  // Twenty-six quotient bits, six at a time: the remainder stays below the
  // divisor, so six more bits stay below 2^30.
  let quotient = 1;
  for (let chunk = 1; chunk <= 4; chunk++) {
    remainder *= 64;
    const digits = floorDiv(remainder, denominatorSignificand);
    remainder -= digits * denominatorSignificand;
    quotient = quotient * 64 + digits;
  }
  remainder *= 4;
  const lastDigits = floorDiv(remainder, denominatorSignificand);
  remainder -= lastDigits * denominatorSignificand;
  quotient = quotient * 4 + lastDigits;
  let rounded = floorDiv(quotient, 8);
  const roundingBits = floorMod(quotient, 8);
  if (roundingBits > 4 || (roundingBits === 4 && (remainder !== 0 || floorMod(rounded, 2) !== 0))) rounded += 1;
  let scale = exponent - 23;
  if (exponent < -126) {
    const subnormalShift = exponent + 149;
    if (subnormalShift < -1) return 0.0;
    if (subnormalShift === -1) {
      rounded = quotient !== 67108864 || remainder !== 0 ? 1 : 0;
    } else {
      let divisor = 1;
      for (let i = 1; i <= 26 - subnormalShift; i++) divisor *= 2;
      rounded = floorDiv(quotient, divisor);
      const roundingRemainder = floorMod(quotient, divisor);
      if (
        roundingRemainder * 2 > divisor ||
        (roundingRemainder * 2 === divisor && (remainder !== 0 || floorMod(rounded, 2) !== 0))
      ) {
        rounded += 1;
      }
    }
    scale = -149;
  } else if (rounded === 16777216) {
    rounded = 8388608;
    exponent += 1;
    scale = exponent - 23;
  }
  if (exponent > 127 || (exponent === 127 && rounded === 16777216)) {
    return negative ? -INFINITY : INFINITY;
  }
  const result = scaleByPowerOfTwo(rounded, scale);
  return negative ? -result : result;
}

/** Correctly rounded square root of a binary32 input, independent of host math. */
export function squareRootFloat32(value: number): number {
  if (value === 0 || value !== value) return value;
  if (value < 0) {
    return INFINITY - INFINITY;
  }
  if (value - value !== 0) return value;
  split(value);
  let significand = splitSignificand;
  let exponent = splitExponent + 23;
  if (floorMod(exponent, 2) !== 0) {
    significand *= 2;
    exponent -= 1;
  }
  // significand * 2^23 fits in two base-2^24 limbs. Each root digit
  // consumes two radicand bits; all arithmetic stays below 2^27.
  let high = floorDiv(significand, 2);
  let low = floorMod(significand, 2) * 8388608;
  let remainder = 0;
  let root = 0;
  for (let i = 0; i < 24; i++) {
    const pair = floorDiv(high, 4194304);
    high = floorMod(high, 4194304) * 4 + floorDiv(low, 4194304);
    low = floorMod(low, 4194304) * 4;
    remainder = remainder * 4 + pair;
    const trial = root * 4 + 1;
    root *= 2;
    if (remainder >= trial) {
      remainder -= trial;
      root += 1;
    }
  }
  // The midpoint's square is root^2 + root + 1/4: an integer
  // radicand cannot tie, so the integer remainder decides rounding.
  if (remainder > root) root += 1;
  return scaleByPowerOfTwo(root, floorDiv(exponent, 2) - 23);
}

function scaleByPowerOfTwo(value: number, scale: number): number {
  let result = value * 1.0;
  let remaining = scale;
  if (remaining < 0) {
    while (remaining <= -16) {
      result *= 0.0000152587890625;
      remaining += 16;
    }
    while (remaining <= -4) {
      result *= 0.0625;
      remaining += 4;
    }
    while (remaining < 0) {
      result *= 0.5;
      remaining += 1;
    }
  } else {
    while (remaining >= 16) {
      result *= 65536.0;
      remaining -= 16;
    }
    while (remaining >= 4) {
      result *= 16.0;
      remaining -= 4;
    }
    while (remaining > 0) {
      result *= 2.0;
      remaining -= 1;
    }
  }
  return result;
}

// Three base-2^24 limbs; each limb's arithmetic stays within signed 32 bits.
interface Limbs {
  high: number;
  middle: number;
  low: number;
}

function shiftRightJam(value: Limbs, count: number): Limbs {
  if (count >= 72) {
    return { high: 0, middle: 0, low: value.high !== 0 || value.middle !== 0 || value.low !== 0 ? 1 : 0 };
  }
  let high = value.high;
  let middle = value.middle;
  let low = value.low;
  let remaining = count;
  while (remaining >= 24) {
    const lost = low !== 0;
    low = middle;
    middle = high;
    high = 0;
    if (lost && floorMod(low, 2) === 0) low += 1;
    remaining -= 24;
  }
  if (remaining > 0) {
    const divisor = at(TWO_POWERS, remaining);
    const carry = at(TWO_POWERS, 24 - remaining);
    const lost = floorMod(low, divisor) !== 0;
    low = floorDiv(low, divisor) + floorMod(middle, divisor) * carry;
    middle = floorDiv(middle, divisor) + floorMod(high, divisor) * carry;
    high = floorDiv(high, divisor);
    if (lost && floorMod(low, 2) === 0) low += 1;
  }
  return { high, middle, low };
}

function addLimbs(a: Limbs, b: Limbs): Limbs {
  const lowSum = a.low + b.low;
  const middleSum = a.middle + b.middle + floorDiv(lowSum, 16777216);
  return {
    high: a.high + b.high + floorDiv(middleSum, 16777216),
    middle: floorMod(middleSum, 16777216),
    low: floorMod(lowSum, 16777216),
  };
}

function lessThan(a: Limbs, b: Limbs): boolean {
  return a.high < b.high || (a.high === b.high && (a.middle < b.middle || (a.middle === b.middle && a.low < b.low)));
}

/** Requires a >= b. */
function subtractLimbs(a: Limbs, b: Limbs): Limbs {
  let low = a.low - b.low;
  let middle = a.middle - b.middle;
  let high = a.high - b.high;
  if (low < 0) {
    low += 16777216;
    middle -= 1;
  }
  if (middle < 0) {
    middle += 16777216;
    high -= 1;
  }
  return { high, middle, low };
}

function bitLength(value: number): number {
  let remaining = value;
  let result = 0;
  if (remaining >= 65536) {
    remaining = floorDiv(remaining, 65536);
    result += 16;
  }
  if (remaining >= 256) {
    remaining = floorDiv(remaining, 256);
    result += 8;
  }
  if (remaining >= 16) {
    remaining = floorDiv(remaining, 16);
    result += 4;
  }
  if (remaining >= 4) {
    remaining = floorDiv(remaining, 4);
    result += 2;
  }
  if (remaining >= 2) {
    remaining = floorDiv(remaining, 2);
    result += 1;
  }
  return result + remaining;
}

function roundLimbs(value: Limbs, scale: number, negative: boolean): number {
  const bits =
    value.high !== 0
      ? 48 + bitLength(value.high)
      : value.middle !== 0
        ? 24 + bitLength(value.middle)
        : bitLength(value.low);
  if (bits === 0) return 0.0;
  let shift = bits - 24;
  if (scale + shift < -149) shift = -149 - scale;
  let rounded = value.low;
  let resultScale = scale;
  if (shift >= 2) {
    const truncated = shiftRightJam(value, shift - 2);
    rounded = truncated.middle * 4194304 + floorDiv(truncated.low, 4);
    const remainder = floorMod(truncated.low, 4);
    if (remainder > 2 || (remainder === 2 && floorMod(rounded, 2) !== 0)) rounded += 1;
    resultScale += shift;
  } else if (shift === 1) {
    rounded = value.middle * 8388608 + floorDiv(value.low, 2);
    if (floorMod(value.low, 2) !== 0 && floorMod(rounded, 2) !== 0) rounded += 1;
    resultScale += 1;
  }
  if (resultScale + bitLength(rounded) > 128) return negative ? -INFINITY : INFINITY;
  const result = scaleByPowerOfTwo(rounded, resultScale);
  return negative ? -result : result;
}

/** a * b + c in three limbs: every finite input and result, subnormal and overflowing ones included. */
function limbFusedMultiplyAdd(a: number, b: number, c: number): number {
  if (a === 0 || b === 0) return a * b + c;
  split(a);
  const leftSignificand = splitSignificand;
  const leftExponent = splitExponent;
  split(b);
  const leftHigh = floorDiv(leftSignificand, 4096);
  const leftLow = floorMod(leftSignificand, 4096);
  const rightHigh = floorDiv(splitSignificand, 4096);
  const rightLow = floorMod(splitSignificand, 4096);
  const first = leftLow * rightLow;
  const second = floorDiv(first, 4096) + leftHigh * rightLow + leftLow * rightHigh;
  const wideHigh = leftHigh * rightHigh + floorDiv(second, 4096);
  const wideLow = floorMod(first, 4096) + floorMod(second, 4096) * 4096;
  // One carry bit above the product and 23 exact zero bits below it.
  let magnitude: Limbs = {
    high: floorDiv(wideHigh, 2),
    middle: floorMod(wideHigh, 2) * 8388608 + floorDiv(wideLow, 2),
    low: floorMod(wideLow, 2) * 8388608,
  };
  let scale = leftExponent + splitExponent - 23;
  let negative = a < 0 !== b < 0;
  if (c !== 0) {
    split(c);
    let other: Limbs = {
      high: floorDiv(splitSignificand, 2),
      middle: floorMod(splitSignificand, 2) * 8388608,
      low: 0,
    };
    const otherScale = splitExponent - 47;
    if (scale < otherScale) {
      magnitude = shiftRightJam(magnitude, otherScale - scale);
      scale = otherScale;
    } else {
      other = shiftRightJam(other, scale - otherScale);
    }
    if (negative === c < 0) {
      magnitude = addLimbs(magnitude, other);
    } else if (lessThan(magnitude, other)) {
      magnitude = subtractLimbs(other, magnitude);
      negative = c < 0;
    } else {
      magnitude = subtractLimbs(magnitude, other);
    }
  }
  return roundLimbs(magnitude, scale, negative);
}
