// Derived from the Binary32 package of tompassarelli/WurstStdlib2 (e3714f6).

import { floorDiv, floorMod } from "./intMath";

export const TWO_POWERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864, 134217728, 268435456, 536870912, 1073741824];

// Three base-2^24 limbs; each limb's arithmetic stays within signed 32 bits.
export interface Limbs {
  high: number;
  middle: number;
  low: number;
}

export function shiftRightJam(value: Limbs, count: number): Limbs {
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
    const divisor = TWO_POWERS[remaining] ?? 1;
    const carry = TWO_POWERS[24 - remaining] ?? 1;
    const lost = floorMod(low, divisor) !== 0;
    low = floorDiv(low, divisor) + floorMod(middle, divisor) * carry;
    middle = floorDiv(middle, divisor) + floorMod(high, divisor) * carry;
    high = floorDiv(high, divisor);
    if (lost && floorMod(low, 2) === 0) low += 1;
  }
  return { high, middle, low };
}

export function addLimbs(a: Limbs, b: Limbs): Limbs {
  const lowSum = a.low + b.low;
  const middleSum = a.middle + b.middle + floorDiv(lowSum, 16777216);
  return {
    high: a.high + b.high + floorDiv(middleSum, 16777216),
    middle: floorMod(middleSum, 16777216),
    low: floorMod(lowSum, 16777216),
  };
}

export function lessThan(a: Limbs, b: Limbs): boolean {
  return a.high < b.high || (a.high === b.high && (a.middle < b.middle || (a.middle === b.middle && a.low < b.low)));
}

export function subtractLimbs(a: Limbs, b: Limbs): Limbs {
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

export function bitLength(value: number): number {
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
