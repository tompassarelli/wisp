import { assertEquals, test } from "../runtime/testing";
import {
  addFloat32,
  divideFloat32,
  fusedMultiplyAddFloat32,
  multiplyFloat32,
  roundToFloat32,
  squareRootFloat32,
  subtractFloat32,
} from "./binary32";

const pow2 = (exponent: number) => 2 ** exponent;
const halfUlp = pow2(-24);
const next = 1 + pow2(-23);
const previous = 1 - pow2(-23);
const quantum = pow2(-149);
const maximum = 16777215 * pow2(104);

// Same value, including the sign of zero; NaN matches NaN.
const same = (actual: number, expected: number) =>
  assertEquals(actual === expected ? 1 / actual === 1 / expected : actual !== actual && expected !== expected, true, `${actual} vs ${expected}`);

test("roundToFloat32: ties go to the even significand, carrying into the next exponent", () => {
  same(roundToFloat32(1 + halfUlp), 1);
  same(roundToFloat32(1 + 3 * halfUlp), 1 + 4 * halfUlp);
  same(roundToFloat32(-1 - 3 * halfUlp), -1 - 4 * halfUlp);
  same(roundToFloat32(2 - pow2(-24)), 2);
  same(roundToFloat32(16777216 + 3), 16777220);
});

test("roundToFloat32: subnormals, underflow, overflow and non-finite values", () => {
  same(roundToFloat32(quantum * 1.5), quantum * 2);
  same(roundToFloat32(quantum * 0.5), 0);
  same(roundToFloat32(pow2(-126) - quantum * 0.5), pow2(-126));
  same(roundToFloat32(maximum), maximum);
  same(roundToFloat32(NaN), NaN);
});

test("fusedMultiplyAddFloat32 rounds the exact a * b + c once: keeps cancellation bits a rounded product would lose", () => {
  same(fusedMultiplyAddFloat32(next, previous, -1), -pow2(-46));
  same(fusedMultiplyAddFloat32(next, next, -(1 + pow2(-22))), pow2(-46));
  same(fusedMultiplyAddFloat32(next, next, halfUlp), 1 + 3 * pow2(-23));
  same(fusedMultiplyAddFloat32(1, halfUlp, next), 1 + pow2(-22));
  same(fusedMultiplyAddFloat32(-1, pow2(-100), 1), 1);
});

test("fusedMultiplyAddFloat32 rounds the exact a * b + c once: the exact product may leave binary32 range before cancellation", () => {
  same(fusedMultiplyAddFloat32(maximum, 2, -maximum), maximum);
  same(fusedMultiplyAddFloat32(quantum, 0.5, quantum), quantum * 2);
  same(fusedMultiplyAddFloat32(quantum, quantum, 0), 0);
  same(fusedMultiplyAddFloat32(maximum, 2, maximum), Infinity);
});

test("division: zero divisor is NaN and overflow is infinite", () => {
  same(divideFloat32(1, 0), NaN);
  same(divideFloat32(maximum, 0.5), Infinity);
  same(divideFloat32(3 * quantum, 2), 2 * quantum);
  same(divideFloat32(quantum, 2), 0);
});

test("square root: exact roots, rounding boundaries, subnormals and non-finite values", () => {
  same(squareRootFloat32(25.0), 5.0);
  same(squareRootFloat32(2.0), 1.4142135381698608);
  same(squareRootFloat32(3.999999761581421), 1.9999998807907104);
  same(squareRootFloat32(4.000000476837158), 2.0);
  same(squareRootFloat32(quantum), 3.743392066509216e-23);
  same(squareRootFloat32(pow2(-126)), pow2(-63));
  same(squareRootFloat32(maximum), 18446742974197923840.0);
  same(squareRootFloat32(0.0), 0.0);
  same(squareRootFloat32(-0.0), -0.0);
  same(squareRootFloat32(Infinity), Infinity);
  same(squareRootFloat32(-1.0), NaN);
  same(squareRootFloat32(NaN), NaN);
});
