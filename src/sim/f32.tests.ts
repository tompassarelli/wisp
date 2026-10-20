import { assertEquals, test } from "../runtime/testing";
import { addFloat32, divideFloat32, multiplyFloat32, subtractFloat32 } from "./binary32";
import { exactDifference, exactProduct, exactQuotient, exactSum, f32 } from "./f32";
import { floorDiv, floorMod } from "./intMath";

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

test("[reference] f32 quotients round the exact quotient to nearest", () => {
  // Warcraft's raw quotient can land an ulp above nearest (wisp:docs/headless.md#raw-float-rounding).
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

test("[reference] f32 literals are the binary32 nearest their decimal", () => {
  // Warcraft read the numeral 0.016666667 as 0.01666666567325592, the binary32 below the nearest.
  same(f32(0.016666667), 0.01666666753590107);
  same(f32(-0.1), -0.10000000149011612);
  same(f32(1.417), 1.4170000553131104);
});

test("[reference] f32 flushes a subnormal result to zero, keeping its sign, as Warcraft does", () => {
  // smashcraft#25: natively the camera's ease stopped at this x, where its step fell below 2^-126.
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

const SMALLEST_NORMAL = 1.1754943508222875e-38;
const flushed = (value: number) => value < SMALLEST_NORMAL && value > -SMALLEST_NORMAL ? value * 0.0 : value;
const priorLeft: number[] = [];
const priorRight: number[] = [];
const priorOperation: number[] = [];
const priorResult: number[] = [];
for (let i = 0; i < 8192; i++) {
  priorLeft.push(0);
  priorRight.push(0);
  priorOperation.push(0);
  priorResult.push(0);
}

function priorSlow(left: number, right: number, operation: number): number {
  let index = -1;
  if (left !== 0 && right !== 0 && left >= -32768 && left <= 32768 && right >= -32768 && right <= 32768) {
    index = (floorDiv(left * 256.0, 1) ^ (floorDiv(right * 256.0, 1) * 31) ^ (operation * 131)) & 8191;
    if (priorLeft[index] === left && priorRight[index] === right && priorOperation[index] === operation) {
      return priorResult[index] ?? 0;
    }
  }
  const result = flushed(operation === 3 ? multiplyFloat32(left, right)
    : operation === 4 ? divideFloat32(left, right)
    : operation === 2 ? subtractFloat32(left, right) : addFloat32(left, right));
  if (index >= 0) {
    priorLeft[index] = left;
    priorRight[index] = right;
    priorOperation[index] = operation;
    priorResult[index] = result;
  }
  return result;
}

function priorProduct(value: number, right: number): number {
  if (value === 0 || right === 0) return value * right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -4096 && value <= 4096 && right >= -4096 && right <= 4096) return value * right;
  if (right === 1 || right === -1 || value === 1 || value === -1) return value * right * 1.0;
  return priorSlow(value, right, 3);
}

function priorQuotient(value: number, right: number): number {
  if (value === 0 || right === 0) return value / right;
  if (value === floorDiv(value, 1) && right === floorDiv(right, 1) && value >= -16777216 && value <= 16777216) {
    const quotient = floorDiv(value, right);
    if (quotient * right === value) return quotient * 1.0;
  }
  return priorSlow(value, right, 4);
}

const priorSum = (value: number, right: number, operation: number) =>
  value === 0 || right === 0 ? (operation === 2 ? value - right : value + right) : priorSlow(value, right, operation);

let seed = 12345;
const draw = () => {
  seed = (seed * 25173 + 13849) & 65535;
  const high = floorDiv(seed, 256);
  seed = (seed * 25173 + 13849) & 65535;
  return high * 256 + floorDiv(seed, 256);
};
const SPECIAL = [0.0, 1.0, 2.0, 0.5, 3.0, 4096.0, 4097.0, 16777216.0, 16777215.0, -2147483648, 3.4028234663852886e38, SMALLEST_NORMAL, 1.401298464324817e-45, 0.0000152587890625, 65536.0, 7.888609052210118e-31, 1 / 0, 0 / 0];
const pool: number[] = [];

function operand(): number {
  const kind = floorDiv(draw(), 8192);
  const bits = draw();
  const low = draw() & 255;
  const negative = (bits & 1) === 1;
  let magnitude: number;
  if (kind === 0) {
    const exponent = floorMod(draw(), 254) + 1;
    magnitude = (8388608 + bits * 128 + (low & 127)) * 2 ** (exponent - 150);
  } else if (kind === 1) {
    magnitude = floorDiv(bits * 256 + low, 2 ** (low & 15));
  } else if (kind === 2) {
    magnitude = (bits & 4095) + 1;
  } else if (kind === 3) {
    magnitude = (8388608 + bits * 128 + (low & 127)) * 2 ** ((low & 31) - 39);
  } else if (kind === 4) {
    const edge = (low & 1) === 1 ? 8388608 + (bits & 3) : 16777215 - (bits & 3);
    magnitude = edge * 2 ** ((low & 63) - 50);
  } else if (kind === 5 && pool.length > 0) {
    magnitude = pool[floorMod(bits, pool.length)] ?? 1.0;
  } else if (kind === 6) {
    magnitude = SPECIAL[floorMod(bits, SPECIAL.length)] ?? 1.0;
  } else {
    magnitude = (bits * 128 + (low & 127)) * 1.401298464324817e-45;
  }
  const value = negative ? -magnitude : magnitude;
  if (pool.length < 64) pool.push(value);
  else pool[low & 63] = value;
  return value;
}

const identical = (actual: number, expected: number, what: string, sameText = true) =>
  assertEquals(actual === expected ? 1 / actual === 1 / expected && (!sameText || `${actual}` === `${expected}`) : actual !== actual && expected !== expected, true, `${what}: ${actual} vs ${expected}`);

test("[property] f32 helpers equal their previous cached implementation bit for bit over generated finite binary32 operands and give the IEEE result for infinite and NaN ones", () => {
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let i = 0; i < 6000; i++) {
    lefts.push(operand());
    rights.push(operand());
  }
  const edges = [1 / 0, -1 / 0, 0 / 0, 0.0, 1.0, -1.5, -4097.0, 3.4028234663852886e38, SMALLEST_NORMAL, 1.401298464324817e-45];
  for (const a of edges) {
    for (const b of edges) {
      if (a - a !== 0 || b - b !== 0) {
        lefts.push(a);
        rights.push(b);
      }
    }
  }
  let nonfinite = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < lefts.length; i++) {
      const a = lefts[i] ?? 0;
      const b = rights[i] ?? 0;
      if (a - a === 0 && b - b === 0) {
        identical(exactProduct(a, b), priorProduct(a, b), `${a} * ${b}`);
        identical(exactQuotient(a, b), priorQuotient(a, b), `${a} / ${b}`);
        identical(exactSum(a, b), priorSum(a, b, 1), `${a} + ${b}`, false);
        identical(exactDifference(a, b), priorSum(a, b, 2), `${a} - ${b}`, false);
        if (b === 0) identical(divideFloat32(a, b), a / b, `divideFloat32(${a}, ${b})`, false);
      } else {
        nonfinite += 1;
        identical(exactProduct(a, b), a * b, `${a} * ${b}`, false);
        identical(exactQuotient(a, b), a / b, `${a} / ${b}`, false);
        identical(exactSum(a, b), a + b, `${a} + ${b}`, false);
        identical(exactDifference(a, b), a - b, `${a} - ${b}`, false);
        identical(multiplyFloat32(a, b), a * b, `multiplyFloat32(${a}, ${b})`, false);
        identical(divideFloat32(a, b), a / b, `divideFloat32(${a}, ${b})`, false);
        identical(addFloat32(a, b), a + b, `addFloat32(${a}, ${b})`, false);
        identical(subtractFloat32(a, b), a - b, `subtractFloat32(${a}, ${b})`, false);
      }
    }
  }
  assertEquals(nonfinite > 100, true, `${nonfinite} pairs with a nonfinite operand`);
});
