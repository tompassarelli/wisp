import { floorDiv } from "../sim/intMath";

// Sync data travels as text: 64 URL-safe characters, one per 6-bit digit.
export const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

export const WIRE_MAX_VALUE = 2147483646;

export function digit(value: number): string {
  return ALPHABET.charAt(value & 63);
}

export function varint(value: number): string {
  let text = "";
  let remaining = value;
  do {
    const payload = remaining & 31;
    remaining = floorDiv(remaining, 32);
    text += ALPHABET.charAt(payload | (remaining > 0 ? 32 : 0));
  } while (remaining > 0);
  return text;
}

export function signedVarint(value: number): string {
  return varint(value < 0 ? -2 * value - 1 : 2 * value);
}

export interface WireReader {
  readonly text: string;
  offset: number;
}

export function wireReader(text: string, offset: number): WireReader {
  return { text, offset };
}

export function atEnd(reader: WireReader): boolean {
  return reader.offset === reader.text.length;
}

export function readDigit(reader: WireReader): number | undefined {
  if (reader.offset >= reader.text.length) return undefined;
  const value = ALPHABET.indexOf(reader.text.charAt(reader.offset));
  if (value < 0) return undefined;
  reader.offset++;
  return value;
}

export function readVarint(reader: WireReader, maximum: number): number | undefined {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 7; index++) {
    const read = readDigit(reader);
    if (read === undefined) return undefined;
    const payload = read & 31;
    const last = read < 32;
    if (last && index > 0 && payload === 0) return undefined;
    if (payload > floorDiv(maximum - value, multiplier)) return undefined;
    value += payload * multiplier;
    if (last) return value;
    multiplier *= 32;
  }
  return undefined;
}

export function readSignedVarint(reader: WireReader, magnitude: number): number | undefined {
  const zigzag = readVarint(reader, 2 * magnitude);
  if (zigzag === undefined) return undefined;
  return (zigzag & 1) === 1 ? -floorDiv(zigzag + 1, 2) : floorDiv(zigzag, 2);
}
