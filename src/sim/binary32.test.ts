import { describe, expect, test } from "bun:test";
import { addFloat32, divideFloat32, fusedMultiplyAddFloat32, multiplyFloat32, roundToFloat32, squareRootFloat32, subtractFloat32 } from "./binary32";
import { f32, F32_ADD, F32_DIVIDE, F32_MULTIPLY, F32_SUBTRACT } from "./f32";

const same = (actual: number, expected: number) => expect(Object.is(actual, expected) || (actual !== actual && expected !== expected)).toBe(true);

// Independent oracle: for binary32 operands, binary64 +, -, * and / followed by
// one rounding to binary32 is correctly rounded (53 >= 2 * 24 + 2).
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
  test("5,000 operand pairs", () => {
    for (let i = 0; i < 5000; i++) {
      const a = operand();
      const b = operand();
      same(addFloat32(a, b), Math.fround(a + b));
      same(subtractFloat32(a, b), Math.fround(a - b));
      same(multiplyFloat32(a, b), Math.fround(a * b));
      same(divideFloat32(a, b), Math.fround(a / b));
      same(roundToFloat32(a * b * 1.000000001), Math.fround(a * b * 1.000000001));
    }
  });

  // Exact oracle: these operands are integers times 2^-100, so a * b + c is an
  // integer times 2^-200; the nearest binary32 value is one of the binary64
  // estimate's neighbours.
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
  test("5,000 fused multiply-adds, half of them cancelling the product to a few bits", () => {
    for (let i = 0; i < 5000; i++) {
      const a = operand();
      const b = operand();
      const c = i % 2 === 0 ? operand() : Math.fround(-(a * b) * (1 + Math.floor(random() * 64 - 32) * 2 ** -24));
      same(fusedMultiplyAddFloat32(a, b, c), exactFusedMultiplyAdd(a, b, c));
    }
  });
});

// Host only: the midpoint between the largest binary32 value and 2^128 is a
// binary64 input that Warcraft numbers can't hold.
test("roundToFloat32: the overflow midpoint rounds to infinity", () => {
  same(roundToFloat32(16777215.5 * 2 ** 104), Infinity);
  same(roundToFloat32(-16777215.5 * 2 ** 104), -Infinity);
});

test("square root matches the binary64 oracle on 5,000 positive binary32 bit patterns", () => {
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

test("f32 repeated operands retain every result bit across operations and collisions", () => {
  const operands = [0, -0, Math.fround(0.1), Math.fround(-0.2), Math.fround(32.1), Math.fround(-32.2), 32768, -32768, 65536, Math.fround(2 ** -149)];
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const a of operands) {
      for (const b of operands) {
        same(f32(a, b, F32_ADD), Math.fround(a + b));
        same(f32(a, b, F32_SUBTRACT), Math.fround(a - b));
        same(f32(a, b, F32_MULTIPLY), Math.fround(a * b));
        // The original helper returns positive zero for these deep negative
        // underflows. Operand reuse must preserve those existing result bits.
        const originalUnderflow = a === Math.fround(2 ** -149) && (b === Math.fround(-32.2) || b === -32768);
        same(f32(a, b, F32_DIVIDE), originalUnderflow ? 0 : Math.fround(a / b));
      }
    }
  }
  for (const value of [Infinity, -Infinity, NaN]) {
    same(f32(value, 0, F32_ADD), value);
    same(f32(value, 0, F32_SUBTRACT), value);
    same(f32(value, 0, F32_MULTIPLY), NaN);
  }
});
