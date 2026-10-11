import { assertEquals, test } from "../runtime/testing";
import { squareRootFloat32 } from "./binary32";

const pow2 = (exponent: number) => 2 ** exponent;
const quantum = pow2(-149);
const maximum = 16777215 * pow2(104);

const same = (actual: number, expected: number) =>
  assertEquals(actual === expected ? 1 / actual === 1 / expected : actual !== actual && expected !== expected, true, `${actual} vs ${expected}`);

test("[reference] square root: exact roots, rounding boundaries, subnormals and non-finite values", () => {
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
