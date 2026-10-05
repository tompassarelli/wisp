import { describe, expect, test } from "bun:test";
import { addFloat32, divideFloat32, multiplyFloat32, roundToFloat32, subtractFloat32 } from "./binary32";

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
});

// Host only: the midpoint between the largest binary32 value and 2^128 is a
// binary64 input that Warcraft numbers can't hold.
test("roundToFloat32: the overflow midpoint rounds to infinity", () => {
  same(roundToFloat32(16777215.5 * 2 ** 104), Infinity);
  same(roundToFloat32(-16777215.5 * 2 ** 104), -Infinity);
});
