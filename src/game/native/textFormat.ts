import { roundToFloat32 } from "../../sim/binary32";
import { f32 } from "../../sim/f32";

function isDigits(text: string): boolean {
  const start = text.startsWith("-") ? 1 : 0;
  if (text.length <= start) return false;
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

// Lua and JavaScript print floats differently; exact binary text keeps runtime comparisons deterministic.

export function describeNumber(value: number): string {
  if (value !== value) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (value === 0) return "0";
  const text = String(value);
  if (isDigits(text)) return text;
  let mantissa = value;
  let exponent = 0;
  while (mantissa !== Math.floor(mantissa) && exponent < 1100) {
    mantissa *= 2;
    exponent++;
  }
  return exponent === 0 ? mantissa.toFixed(0) : `${mantissa.toFixed(0)}p-${exponent}`;
}

// JASS S2I skips leading spaces; S2R does not (wisp:docs/warsmash-notes.md, Script rules).

function leadingNumber(text: string, fraction: boolean): number {
  let start = 0;
  while (!fraction && start < text.length && text.charAt(start) === " ") start++;
  let end = start;
  if (end < text.length && (text.charAt(end) === "-" || text.charAt(end) === "+")) end++;
  let digits = 0;
  let point = false;
  while (end < text.length) {
    const character = text.charAt(end);
    if (character >= "0" && character <= "9") digits++;
    else if (fraction && character === "." && !point) point = true;
    else break;
    end++;
  }
  if (digits === 0) return 0;
  const value = Number(text.slice(start, end));
  return value === value ? value : 0;
}

// Warcraft R2S/R2SW round exact ties away from zero and retain negative zero; host formatters differ.

export function fixed(value: number, digits: number): string {
  const real = roundToFloat32(value);
  if (real !== real || real === Infinity || real === -Infinity || real >= f32(1e21) || real <= -f32(1e21)) return real.toFixed(digits);
  // 30 more digits than kept: no binary32 is that close to a tie without being one.
  const expanded = (real < 0 ? -real : real).toFixed(digits + 30);
  const point = expanded.indexOf(".");
  const kept = expanded.slice(0, point) + expanded.slice(point + 1, point + 1 + digits);
  const rest = expanded.slice(point + 1 + digits);
  let digitsText = kept;
  if (rest.charAt(0) >= "5") {
    let carry = digitsText.length - 1;
    while (carry >= 0 && digitsText.charAt(carry) === "9") carry--;
    digitsText = carry < 0
      ? `1${"0".repeat(digitsText.length)}`
      : digitsText.slice(0, carry) + String.fromCharCode(digitsText.charCodeAt(carry) + 1) + "0".repeat(digitsText.length - carry - 1);
  }
  const whole = digitsText.slice(0, digitsText.length - digits);
  const text = digits > 0 ? `${whole}.${digitsText.slice(digitsText.length - digits)}` : whole;
  return real < 0 ? `-${text}` : text;
}

// R2SW pads to width and rounds to at least one decimal (wisp:docs/warsmash-notes.md, Script rules).

export function fixedWidth(value: number, width: number, precision: number): string {
  let text = fixed(value, precision > 0 ? precision : 0);
  if (precision <= 0) text = `${text}.0`;
  while (text.length < width + 1) text = ` ${text}`;
  return text;
}

export const truncated = (value: number): number => (value < 0 ? Math.ceil(value) : Math.floor(value));

export const parsedInteger = (text: string): number => truncated(leadingNumber(text, false));

export const parsedReal = (text: string): number => Math.fround(leadingNumber(text, true));
