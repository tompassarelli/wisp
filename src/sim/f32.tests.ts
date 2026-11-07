import { assertEquals, test } from "../runtime/testing";
import { f32 } from "./f32";

const same = (actual: number, expected: number) =>
  assertEquals(actual === expected && 1 / actual === 1 / expected, true, `${actual} vs ${expected}`);

test("[reference] f32 arithmetic rounds the exact result to nearest", () => {
  // Warcraft's raw product can land an ulp toward zero (wisp:docs/headless.md#raw-float-rounding).
  const speed = 24.599998474121094;
  const factor = 0.9399999976158142;
  same(f32(speed * factor), 23.123998641967773);
  const tenth = 0.10000000149011612;
  const fifth = 0.20000000298023224;
  same(f32(tenth + fifth), 0.30000001192092896);
  same(f32(tenth - fifth), -0.10000000149011612);
  const next = 1.0000001192092896;
  same(f32(next * next), 1.000000238418579);
  same(f32(next - 1.0), 1.1920928955078125e-7);
  same(f32((16777215 + 2)), 16777216);
  same(f32(-1 - 16777216), -16777216);
  same(f32(1.5 * 4096.5), 6144.75);

  for (let i = 0; i < 3; i++) {
    same(f32(tenth + fifth), 0.30000001192092896);
    same(f32(32.099998474121094 + fifth), 32.29999923706055);
    same(f32(tenth * fifth), 0.020000001415610313);
    same(f32(tenth / fifth), 0.5);
    same(f32(tenth - fifth), -0.10000000149011612);
    same(f32(speed * factor), 23.123998641967773);
  }
});

// One binary64 operation then binary32 rounding is a nearest-even oracle.


test("[reference] f32 flushes a subnormal result to zero, keeping its sign, as Warcraft does", () => {
  // makgora#25: natively the camera's ease stopped at this x, where its step fell below 2^-126.
  const stopped = 1.1940069608864212e-37;
  const rate = 0.09000000357627869;
  same(f32(f32(0.0 - stopped) * rate), -0.0);
  same(f32(stopped * rate), 0.0);
  same(f32(stopped + f32(f32(0.0 - stopped) * rate)), stopped);
  const smallestNormal = 1.1754943508222875e-38;
  same(f32(1.7632415262334313e-38 - smallestNormal), 0.0);
  same(f32(smallestNormal - 1.7632415262334313e-38), -0.0);
  same(f32(2.350988701644575e-38 / 3.0), 0.0);
  same(f32(smallestNormal + smallestNormal), 2.350988701644575e-38);
  same(f32(smallestNormal * 1.5), 1.7632415262334313e-38);
});



