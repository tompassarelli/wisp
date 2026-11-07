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
