// IEEE 754 binary32 arithmetic, ported from the Binary32 package of
// tompassarelli/WurstStdlib2 (e3714f6). Every operation rounds once, to nearest
// with ties to even, on binary64 hosts and in Warcraft's binary32 Lua alike.
// Integer limbs stay below 2^31, the range of Warcraft's Lua integers.
import { floorDiv, floorMod } from "./intMath";

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

/** Rounds to the nearest binary32 value; NaN and infinity pass through. */
export function roundToFloat32(value: number): number {
  if (value === 0 || value !== value) return value;
  const negative = value < 0;
  let significand = negative ? -value : value;
  let scale = 1.0;
  let exponent = 0;
  while (significand >= 2 && exponent < 127) {
    significand *= 0.5;
    scale *= 2;
    exponent += 1;
  }
  if (significand >= 2) return negative ? -binary32Infinity() : binary32Infinity();
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
    return negative ? -binary32Infinity() : binary32Infinity();
  }
  const result = (rounded / 8388608.0) * scale;
  return negative ? -result : result;
}

export function addFloat32(a: number, b: number): number {
  return fusedMultiplyAddFloat32(1.0, a, b);
}

export function subtractFloat32(a: number, b: number): number {
  return fusedMultiplyAddFloat32(-1.0, b, a);
}

export function multiplyFloat32(a: number, b: number): number {
  return fusedMultiplyAddFloat32(a, b, 0.0);
}

interface Parts {
  significand: number;
  exponent: number;
}

function decompose(value: number): Parts {
  let normalized = value < 0 ? -value : value;
  let exponent = -23;
  while (normalized >= 2) {
    normalized *= 0.5;
    exponent += 1;
  }
  while (normalized < 1) {
    normalized *= 2;
    exponent -= 1;
  }
  return { significand: Math.floor(normalized * 8388608.0), exponent };
}

/** Long division keeps the quotient and sticky remainder; a zero divisor gives NaN. */
export function divideFloat32(numerator: number, denominator: number): number {
  if (denominator === 0) {
    const infinity = binary32Infinity();
    return infinity - infinity;
  }
  if (numerator === 0) return numerator;
  const left = decompose(numerator);
  const right = decompose(denominator);
  const negative = numerator < 0 !== denominator < 0;
  let remainder = left.significand;
  let exponent = left.exponent - right.exponent;
  if (remainder < right.significand) {
    remainder *= 2;
    exponent -= 1;
  }
  remainder -= right.significand;
  let quotient = 1;
  for (let i = 1; i <= 26; i++) {
    remainder *= 2;
    quotient *= 2;
    if (remainder >= right.significand) {
      remainder -= right.significand;
      quotient += 1;
    }
  }
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
    return negative ? -binary32Infinity() : binary32Infinity();
  }
  const result = scaleByPowerOfTwo(rounded, scale);
  return negative ? -result : result;
}

function scaleByPowerOfTwo(value: number, scale: number): number {
  let result = value * 1.0;
  if (scale < 0) {
    for (let i = 1; i <= -scale; i++) result *= 0.5;
  } else {
    for (let i = 1; i <= scale; i++) result *= 2.0;
  }
  return result;
}

// Three base-2^24 limbs; each limb's arithmetic stays within signed 32 bits.
interface Limbs {
  high: number;
  middle: number;
  low: number;
}

function multiplySignificands(a: number, b: number): { high: number; low: number } {
  // Twelve-bit factors keep every partial product within signed 32 bits.
  const aLow = floorMod(a, 4096);
  const bLow = floorMod(b, 4096);
  const aHigh = floorDiv(a, 4096);
  const bHigh = floorDiv(b, 4096);
  const first = aLow * bLow;
  const second = floorDiv(first, 4096) + aHigh * bLow + aLow * bHigh;
  return {
    high: aHigh * bHigh + floorDiv(second, 4096),
    low: floorMod(first, 4096) + floorMod(second, 4096) * 4096,
  };
}

function shiftRightJam(value: Limbs, count: number): Limbs {
  if (count >= 72) {
    return { high: 0, middle: 0, low: value.high !== 0 || value.middle !== 0 || value.low !== 0 ? 1 : 0 };
  }
  let result = value;
  let remaining = count;
  while (remaining >= 24) {
    const lost = result.low !== 0;
    result = { high: 0, middle: result.high, low: result.middle };
    if (lost && floorMod(result.low, 2) === 0) result.low += 1;
    remaining -= 24;
  }
  for (let i = 1; i <= remaining; i++) {
    const lost = floorMod(result.low, 2) !== 0;
    result = {
      high: floorDiv(result.high, 2),
      middle: floorDiv(result.middle, 2) + floorMod(result.high, 2) * 8388608,
      low: floorDiv(result.low, 2) + floorMod(result.middle, 2) * 8388608,
    };
    if (lost && floorMod(result.low, 2) === 0) result.low += 1;
  }
  return result;
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
  while (remaining !== 0) {
    remaining = floorDiv(remaining, 2);
    result += 1;
  }
  return result;
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
  if (resultScale + bitLength(rounded) > 128) return negative ? -binary32Infinity() : binary32Infinity();
  const result = scaleByPowerOfTwo(rounded, resultScale);
  return negative ? -result : result;
}

/**
 * a * b + c with one binary32 rounding. Inputs must be finite binary32 values;
 * the exact product may leave binary32 range before cancellation.
 */
export function fusedMultiplyAddFloat32(a: number, b: number, c: number): number {
  if (a === 0 || b === 0) return a * b + c;
  const left = decompose(a);
  const right = decompose(b);
  const product = multiplySignificands(left.significand, right.significand);
  // One carry bit above the product and 23 exact zero bits below it.
  let magnitude: Limbs = {
    high: floorDiv(product.high, 2),
    middle: floorMod(product.high, 2) * 8388608 + floorDiv(product.low, 2),
    low: floorMod(product.low, 2) * 8388608,
  };
  let scale = left.exponent + right.exponent - 23;
  let negative = a < 0 !== b < 0;
  if (c !== 0) {
    const addend = decompose(c);
    let other: Limbs = {
      high: floorDiv(addend.significand, 2),
      middle: floorMod(addend.significand, 2) * 8388608,
      low: 0,
    };
    const otherScale = addend.exponent - 47;
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
