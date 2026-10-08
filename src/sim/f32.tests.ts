// f32 arithmetic as Lua runs it: the compiler sends f32(a + b), f32(a - b),
// f32(a * b) and f32(a / b) through f32's exact path (wisp:src/sim/f32.ts),
// and prints literals as exact hexadecimal floats, which must give the host's
// Math.fround result whatever Warcraft's raw operators and numerals do.
import { assertEquals, test } from "../runtime/testing";
import { f32 } from "./f32";

// Same value, including the sign of zero.
const same = (actual: number, expected: number) =>
  assertEquals(actual === expected && 1 / actual === 1 / expected, true, `${actual} vs ${expected}`);

test("[reference] f32 arithmetic rounds the exact result to nearest", () => {
  // Smashcraft 0.0.48's Rifleman aerial jump speed: Warcraft's raw product was 23.12399673461914, an ulp toward zero.
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
  // Repeated operations share operands, while these offsets collide in the
  // helper's lookup. Only exact operands and the operation may reuse a result.
  for (let i = 0; i < 3; i++) {
    same(f32(tenth + fifth), 0.30000001192092896);
    same(f32(32.099998474121094 + fifth), 32.29999923706055);
    same(f32(tenth * fifth), 0.020000001415610313);
    same(f32(tenth / fifth), 0.5);
    same(f32(tenth - fifth), -0.10000000149011612);
    same(f32(speed * factor), 23.123998641967773);
  }
});

test("[reference] f32 arithmetic keeps zero signs and small integers", () => {
  const zero = 0.0;
  const negative = -5000.5;
  same(f32(zero * negative), -0.0);
  same(f32(-2.5 + 2.5), 0.0);
  same(f32(-zero - zero), -0.0);
  same(f32(negative - zero), negative);
  same(f32(3 * 4), 12);
  same(f32(40 - 2), 38);
});

// IEEE round to nearest, ties to even (the host's binary64 sum rounded to
// binary32 is exact for one operation), at each rounding branch of f32's sums.
const SUMS: readonly (readonly [name: string, a: number, b: number, operation: "+" | "-", expected: number])[] = [
  ["a tie keeps the even unit", 8192.0, 0.00048828125, "+", 8192.0],
  ["a tie rounds an odd unit up", 8192.0009765625, 0.00048828125, "+", 8192.001953125],
  ["a carry reaches the next binade", 16383.9990234375, 0.000732421875, "+", 16384.0],
  ["past the binade an odd unit and a fraction round up", 16383.9990234375, 0.001220703125, "+", 16384.0],
  ["past the binade a tie keeps the even unit below", 16383.9990234375, 0.001953125, "+", 16384.0],
  ["past the binade a tie rounds to the even unit above", 16383.9990234375, 0.00390625, "+", 16384.00390625],
  ["a difference below the binade counts half units", 8192.0, 0.0002929687616415322, "-", 8191.99951171875],
  ["a quarter unit below the binade ties to the even half", 8192.0, 0.000244140625, "-", 8192.0],
  ["three quarter units below the binade tie to the even half", 8192.0, 0.000732421875, "-", 8191.9990234375],
  ["less than a quarter unit leaves the larger value", 8192.0, 0.00019531250291038305, "-", 8192.0],
  ["a difference within a factor of two is exact", 1.5, 1.25, "-", 0.25],
  ["an exact cancellation is positive zero", 1234.5677490234375, 1234.5677490234375, "-", 0.0],
  ["the smallest magnitude the integer path takes", 0.0000152587890625, 2.999999970665357e-10, "+", 0.000015259089195751585],
  ["the largest magnitude the integer path takes", 65535.99609375, 0.001953125, "+", 65536.0],
  ["an integer and a fraction", 7000, 0.10000000149011612, "-", 6999.89990234375],
];

test("[reference] f32 sums and differences round ties to even at every binade edge", () => {
  for (const [name, a, b, operation, expected] of SUMS) {
    const sum = operation === "+" ? f32(a + b) : f32(a - b);
    assertEquals(sum === expected && 1 / sum === 1 / expected, true, `${name}: ${sum} vs ${expected}`);
    const negated = operation === "+" ? f32(-a - b) : f32(-a + b);
    assertEquals(negated === -expected && 1 / negated === 1 / (expected === 0 ? expected : -expected), true, `${name}, negated: ${negated} vs ${-expected}`);
  }
});

test("[reference] f32 differences within a factor of two and products with ±1 are exact", () => {
  const position = 230.71875;
  const near = 160.3000030517578;
  same(f32(position - near), 70.41874694824219);
  same(f32(-position + near), -70.41874694824219);
  same(f32(near - position), -70.41874694824219);
  const offset = 3.0999999046325684;
  same(f32(offset * -1), -3.0999999046325684);
  same(f32(1 * offset), 3.0999999046325684);
  same(f32(-1 * -offset), 3.0999999046325684);
});

test("[reference] f32 quotients round the exact quotient to nearest", () => {
  // Smashcraft's camera zoom on 7 October 2026: Warcraft's raw quotient was 765.6729125976562, an ulp above the nearest.
  const height = 379.64483642578125;
  const span = 0.4958316385746002;
  same(f32(height / span), 765.6728515625);
  const seconds = 1.4170000553131104;
  const clip = 0.5666667222976685;
  same(f32(seconds / clip), 2.5005881786346436);
  same(f32(1.0 / 3.0), 0.3333333432674408);
  same(f32(-1.0 / 3.0), -0.3333333432674408);
  same(f32(height / -2.0), -189.82241821289062);
});

test("[reference] f32 quotients keep zero signs and exact integer quotients", () => {
  const zero = 0.0;
  const negative = -5000.5;
  same(f32(zero / negative), -0.0);
  same(f32(84 / 7), 12);
  same(f32(-84.0 / 7.0), -12);
  same(f32(7 / 84), 0.0833333358168602);
});

test("[reference] f32 literals are the binary32 nearest their decimal", () => {
  // Warcraft read the numeral 0.016666667 as 0.01666666567325592, the binary32 below the nearest.
  same(f32(0.016666667), 0.01666666753590107);
  same(f32(-0.1), -0.10000000149011612);
  same(f32(1.417), 1.4170000553131104);
});
