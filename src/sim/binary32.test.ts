import { describe, expect, test } from "bun:test";
import { addFloat32, divideFloat32, fusedMultiplyAddFloat32, multiplyFloat32, roundToFloat32, squareRootFloat32, subtractFloat32 } from "./binary32";
import { exactDifference, exactProduct, exactQuotient, exactSum } from "./f32";

const same = (actual: number, expected: number) => expect(Object.is(actual, expected) || (actual !== actual && expected !== expected)).toBe(true);

// Binary64 then binary32 rounding is an independent oracle for one operation: 53 >= 2 * 24 + 2.

describe("operations match the binary64 oracle on random binary32 operands", () => {
  let state = 0x2545f491;
  const random = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  const operand = () => {
    const sign = random() < 0.5 ? -1 : 1;
    return Math.fround(sign * (1 + random()) * 2 ** Math.floor(random() * 80 - 40));
  };
  test("[reference] 5,000 operand pairs", () => {
    for (let i = 0; i < 5000; i++) {
      const a = operand();
      const b = operand();
      same(addFloat32(a, b), Math.fround(a + b));
      same(subtractFloat32(a, b), Math.fround(a - b));
      same(multiplyFloat32(a, b), Math.fround(a * b));
      same(divideFloat32(a, b), Math.fround(a / b));
      same(roundToFloat32(a * b * 1.000000001), Math.fround(a * b * 1.000000001));
      same(exactSum(a, b), Math.fround(a + b));
      same(exactDifference(a, b), Math.fround(a - b));
      same(exactProduct(a, b), Math.fround(a * b));
      same(exactQuotient(a, b), Math.fround(a / b));
    }
  });

  // Integer operands scaled by 2^-100 make a * b + c an exact integer times 2^-200.

  const view = new DataView(new ArrayBuffer(4));
  const step = (value: number, by: number) => {
    view.setFloat32(0, value);
    view.setInt32(0, view.getInt32(0) + (value < 0 ? -by : by));
    return view.getFloat32(0);
  };
  const scaled = (value: number, power: number) => BigInt(value * 2 ** power);
  const exactFusedMultiplyAdd = (a: number, b: number, c: number) => {
    const exact = scaled(a, 100) * scaled(b, 100) + scaled(c, 200);
    if (exact === 0n) return 0;
    const estimate = Math.fround(Number(exact) / 2 ** 200);
    let best = estimate;
    let bestError = -1n;
    for (const candidate of [step(estimate, -1), estimate, step(estimate, 1)]) {
      const difference = exact - scaled(candidate, 200);
      const error = difference < 0n ? -difference : difference;
      view.setFloat32(0, candidate);
      const even = (view.getInt32(0) & 1) === 0;
      if (bestError < 0n || error < bestError || (error === bestError && even)) {
        best = candidate;
        bestError = error;
      }
    }
    return best;
  };
  test("[reference] 5,000 fused multiply-adds, half of them cancelling the product to a few bits", () => {
    for (let i = 0; i < 5000; i++) {
      const a = operand();
      const b = operand();
      const c = i % 2 === 0 ? operand() : Math.fround(-(a * b) * (1 + Math.floor(random() * 64 - 32) * 2 ** -24));
      same(fusedMultiplyAddFloat32(a, b, c), exactFusedMultiplyAdd(a, b, c));
    }
  });
});

// Warcraft cannot hold the binary64 midpoint between the largest binary32 value and 2^128.

test("[reference] square root matches the binary64 oracle on 5,000 positive binary32 bit patterns", () => {
  const view = new DataView(new ArrayBuffer(4));
  let state = 0x2545f491;
  for (let i = 0; i < 5000; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const bits = (state & 0x7fffffff) % 0x7f800000;
    view.setUint32(0, bits);
    const value = view.getFloat32(0);
    expect(squareRootFloat32(value)).toBe(Math.fround(Math.sqrt(value)));
  }
});
