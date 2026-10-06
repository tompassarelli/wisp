// wisp:native/warcraft-rounding.h against an exact oracle: every binary32
// sum, difference and product the Warcraft-rounding Lua computes must be the
// exact result truncated toward zero, computed here with integers. The Lua is
// WARCRAFT_LUA when set (CI builds it with make), else one built with nix in
// build/warcraft-lua (wisp:scripts/wisp/warcraftLua.ts).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { luaRounding, warcraftLua } from "../scripts/wisp/warcraftLua";

const lua = process.env.WARCRAFT_LUA ?? await Effect.runPromise(warcraftLua(join(import.meta.dir, "../build/warcraft-lua")));

/** A finite binary32 value as sign × significand × 2^exponent, with an integer significand. */
interface Exact {
  readonly sign: 1n | -1n;
  readonly significand: bigint;
  readonly exponent: number;
}

function exact(value: number): Exact {
  const bits = new DataView(new Float32Array([value]).buffer).getUint32(0, true);
  const biased = (bits >>> 23) & 0xff;
  const fraction = BigInt(bits & 0x7fffff);
  const sign = bits >>> 31 === 1 ? -1n : 1n;
  return biased === 0 ? { sign, significand: fraction, exponent: -149 } : { sign, significand: fraction | 0x800000n, exponent: biased - 150 };
}

const MAXIMUM = 16777215 * 2 ** 104;

/** sign × magnitude × 2^exponent rounded toward zero to binary32. */
function towardZero(negative: boolean, magnitude: bigint, exponent: number): number {
  if (magnitude === 0n) return 0;
  const length = magnitude.toString(2).length;
  // Keep 24 significant bits, or fewer below the subnormal quantum 2^-149.
  const target = Math.max(exponent + length - 24, -149);
  let kept = magnitude;
  let at = exponent;
  if (target > exponent) {
    kept = magnitude >> BigInt(target - exponent);
    at = target;
  }
  const value = kept === 0n ? 0 : Number(kept) * 2 ** at;
  const limited = value > MAXIMUM ? MAXIMUM : value;
  return negative ? -limited : limited;
}

function sum(a: number, b: number): number {
  if (a === 0 && b === 0) return Object.is(a, -0) && Object.is(b, -0) ? -0 : 0;
  const x = exact(a);
  const y = exact(b);
  const exponent = Math.min(x.exponent, y.exponent);
  const total = x.sign * (x.significand << BigInt(x.exponent - exponent)) + y.sign * (y.significand << BigInt(y.exponent - exponent));
  return towardZero(total < 0n, total < 0n ? -total : total, exponent);
}

function product(a: number, b: number): number {
  const x = exact(a);
  const y = exact(b);
  const negative = x.sign * y.sign < 0n;
  const result = towardZero(negative, x.significand * y.significand, x.exponent + y.exponent);
  return result === 0 && negative ? -0 : result;
}

/** A binary32 value as a C hex float Lua reads exactly. */
function hex(value: number): string {
  const { sign, significand, exponent } = exact(value);
  return `${sign < 0n ? "-" : ""}0x${significand.toString(16)}p${exponent}`;
}

/** Lua's %a text: [-]0xH.HHHp±D, or inf and nan. */
function parseHex(text: string): number {
  if (/nan/.test(text)) return NaN;
  if (/inf/.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  const match = /^(-?)0x([0-9a-f]+)(?:\.([0-9a-f]*))?p([+-]\d+)$/.exec(text);
  if (match === null) throw new Error(`not a hex float: ${text}`);
  const [, sign, whole = "", fraction = "", exponent = "0"] = match;
  const value = Number(BigInt(`0x${whole}${fraction}`)) * 2 ** (Number(exponent) - 4 * fraction.length);
  return sign === "-" ? -value : value;
}

/** Deterministic operands: random significands over the whole exponent range, near exponents and far ones, subnormals and edges. */
function operands(): [number, number][] {
  let state = 0x2545f491;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state;
  };
  const value = (exponent: number) => Math.fround((next() % 0x1000000) * 2 ** (exponent - 23) * (next() % 2 === 0 ? 1 : -1));
  const pairs: [number, number][] = [
    [1, 2 ** -24], [1, -(2 ** -25)], [1, 3 * 2 ** -24], [3, 1e-30], [3, -1e-30], [-2.5e7, 1e-30],
    [MAXIMUM, MAXIMUM], [MAXIMUM, -MAXIMUM], [2 ** -149, 2 ** -149], [2 ** -149, 0.5], [2 ** -126, -(2 ** -149)],
    [Math.fround(4.1), Math.fround(0.94)], [0, -0], [-0, -0], [1, -1], [-1, 0],
  ];
  for (let index = 0; index < 4000; index++) {
    const exponent = (next() % 250) - 124;
    const gap = index % 4 === 0 ? (next() % 60) - 30 : (next() % 6) - 3;
    pairs.push([value(exponent), value(Math.max(-140, Math.min(126, exponent + gap)))]);
  }
  return pairs;
}

const same = (actual: number, expected: number) => Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected));

test("the Warcraft-rounding Lua's + - * are the exact results truncated toward zero, and / rounds to nearest", async () => {
  expect(luaRounding(lua)).toBe("warcraft");
  const pairs = operands();
  const program = [
    "for line in io.lines() do",
    "  local x, y = line:match('(%S+) (%S+)')",
    "  local a, b = tonumber(x), tonumber(y)",
    "  print(string.format('%a %a %a %a', a + b, a - b, a * b, a / 2))",
    "end",
  ].join("\n");
  const run = Bun.spawnSync([lua, "-e", program], { stdin: new TextEncoder().encode(`${pairs.map(([a, b]) => `${hex(a)} ${hex(b)}`).join("\n")}\n`), stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const lines = run.stdout.toString().trimEnd().split("\n");
  expect(lines.length).toBe(pairs.length);
  const wrong: string[] = [];
  pairs.forEach(([a, b], index) => {
    const [added = "", subtracted = "", multiplied = "", halved = ""] = (lines[index] ?? "").split(" ");
    const expected = [sum(a, b), sum(a, -b), product(a, b), Math.fround(a / 2)];
    [added, subtracted, multiplied, halved].map(parseHex).forEach((actual, operation) => {
      if (!same(actual, expected[operation] ?? NaN)) wrong.push(`${hex(a)} ${"+-*/"[operation]} ${hex(b)}: ${actual} instead of ${expected[operation]}`);
    });
  });
  expect(wrong.slice(0, 10)).toEqual([]);
  // Round-to-nearest gives 3 and 3 here; Warcraft truncates toward zero.
  expect(lines[3]?.split(" ").slice(0, 2)).toEqual(["0x1.8p+1", "0x1.7ffffep+1"]);
});
