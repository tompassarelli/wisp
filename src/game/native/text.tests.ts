import { f32 } from "../../sim/f32";
import { assertEquals, test } from "../../runtime/testing";
import { formatInt, formatReal, formatRealWidth, parseInt, parseReal, textLength, toReal, truncate } from "./text";

const same = (actual: unknown, expected: unknown) => assertEquals(actual, expected);

test("[reference] text: formatReal keeps R2S's binary32 digits, rounds exact ties away from zero and keeps negative zero", () => {
  const rows: readonly (readonly [number, string])[] = [
    [0, "0.000"], [1, "1.000"], [-1, "-1.000"], [0.5, "0.500"], [0.0625, "0.063"], [-0.0625, "-0.063"], [1.0625, "1.063"], [2.0625, "2.063"],
    [f32(0.1), "0.100"], [1 / 3, "0.333"], [2 / 3, "0.667"], [f32(99.9995), "99.999"], [f32(99.99951), "100.000"], [f32(123456.789), "123456.789"], [f32(-0.0004), "-0.000"], [f32(0.0004), "0.000"],
    [16777216, "16777216.000"], [1000000.5, "1000000.500"], [f32(0.9995), "0.999"], [f32(0.99951), "1.000"],
  ];
  for (const [value, text] of rows) same(formatReal(value), text);
});

test("[reference] text: formatRealWidth pads to the width and keeps at least one decimal", () => {
  same(formatRealWidth(0.5, 0, 0), "1.0");
  same(formatRealWidth(2.5, 0, 0), "3.0");
  same(formatRealWidth(-2.5, 0, 0), "-3.0");
  same(formatRealWidth(f32(3.14159), 6, 2), "   3.14");
  same(formatRealWidth(f32(3.14159), 3, 2), "3.14");
  same(formatRealWidth(0.125, 5, 2), "  0.13");
  same(formatRealWidth(0.375, 5, 2), "  0.38");
  same(formatRealWidth(42, 8, 1), "     42.0");
  same(formatRealWidth(-7.25, 4, 1), " -7.3");
});

test("[reference] text: formatInt prints integers and truncate rounds toward zero", () => {
  for (const [value, text] of [[0, "0"], [7, "7"], [-7, "-7"], [2147483647, "2147483647"], [-2147483648, "-2147483648"], [60, "60"]] as const) same(formatInt(value), text);
  for (const [value, whole] of [[f32(2.9), 2], [f32(-2.9), -2], [0.5, 0], [-0.5, 0], [100, 100], [f32(-100.0001), -100]] as const) same(truncate(value), whole);
  same(toReal(5), 5);
});

test("[reference] text: parseInt skips leading spaces and stops at the first non-digit, parseReal takes a fraction and keeps binary32", () => {
  for (const [text, value] of [["42", 42], ["  42", 42], ["-17", -17], ["+9", 9], ["12abc", 12], ["abc", 0], ["", 0], ["3.9", 3], ["-3.9", -3], [" -8 ", -8]] as const) same(parseInt(text), value);
  for (const [text, value] of [["1.5", 1.5], ["-0.25", -0.25], [".5", 0.5], ["2", 2], ["x", 0], ["", 0], ["1.5.5", 1.5], ["  1.5", 0], ["0.1", 0.10000000149011612]] as const) same(parseReal(text), value);
});

test("[reference] text: textLength counts characters", () => {
  same(textLength(""), 0);
  same(textLength("Wisp"), 4);
  same(textLength("a b"), 3);
});
