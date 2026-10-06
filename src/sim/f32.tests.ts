// f32 arithmetic as Lua runs it: the compiler sends f32(a + b), f32(a - b)
// and f32(a * b) through f32's exact path (wisp:src/sim/f32.ts), which must
// give the host's Math.fround result whatever Warcraft's raw operators do.
import { assertEquals, test } from "../runtime/testing";
import { f32 } from "./f32";

// Same value, including the sign of zero.
const same = (actual: number, expected: number) =>
  assertEquals(actual === expected && 1 / actual === 1 / expected, true, `${actual} vs ${expected}`);

test("f32 arithmetic rounds the exact result to nearest", () => {
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
});

test("f32 arithmetic keeps zero signs and small integers", () => {
  const zero = 0.0;
  const negative = -5000.5;
  same(f32(zero * negative), -0.0);
  same(f32(-2.5 + 2.5), 0.0);
  same(f32(-zero - zero), -0.0);
  same(f32(negative - zero), negative);
  same(f32(3 * 4), 12);
  same(f32(40 - 2), 38);
});
