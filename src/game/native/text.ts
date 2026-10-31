import { describeNumber, fixed, fixedWidth, parsedInteger, parsedReal, truncated } from "./textFormat";
import { logNativeCall } from "./world";

export function formatInt(value: number): string {
  logNativeCall("I2S", [value]);
  return describeNumber(value);
}

export function formatReal(value: number): string {
  logNativeCall("R2S", [value]);
  return fixed(value, 3);
}

export function formatRealWidth(value: number, width: number, precision: number): string {
  logNativeCall("R2SW", [value, width, precision]);
  return fixedWidth(value, width, precision);
}

export function parseInt(text: string): number {
  logNativeCall("S2I", [text]);
  return parsedInteger(text);
}

export function parseReal(text: string): number {
  logNativeCall("S2R", [text]);
  return parsedReal(text);
}

export function toReal(value: number): number {
  logNativeCall("I2R", [value]);
  return value;
}

export function truncate(value: number): number {
  logNativeCall("R2I", [value]);
  return truncated(value);
}

export function textLength(text: string): number {
  logNativeCall("StringLength", [text]);
  return text.length;
}
