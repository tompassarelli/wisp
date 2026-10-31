import type { NativeCall } from "./clientTypes";
import { describeNumber } from "../game/native/textFormat";
import { isHandle } from "./jassFormat";

// Products below 2^53 and | 0 preserve Lua32 wrapping hash arithmetic in JavaScript.

const mix = (hash: number, value: number) => (hash * 1000003 + value) | 0;

function mixText(hash: number, text: string): number {
  let mixed = hash;
  for (let index = 0; index < text.length; index++) mixed = mix(mixed, text.charCodeAt(index));
  return mix(mixed, text.length);
}

const nameHashes = new Map<string, number>();

export function mixCall(hash: number, { name, args }: NativeCall): number {
  let mixed = mixName(hash, name);
  for (let index = 0; index < args.length; index++) mixed = mixValue(mixed, args[index]);
  return mixed;
}

function mixName(hash: number, name: string): number {
  let named = nameHashes.get(name);
  if (named === undefined) {
    named = mixText(0, name);
    nameHashes.set(name, named);
  }
  return mix(hash, named);
}

const INT32_LIMIT = 2147483648;

function mixValue(hash: number, value: unknown): number {
  if (typeof value === "number") {
    // Math.floor makes an integral Lua float an integer, which Lua's `|` needs.
    if (value === Math.floor(value) && value >= -INT32_LIMIT && value < INT32_LIMIT) return mix(mix(hash, 1), Math.floor(value));
    return mixText(mix(hash, 2), describeNumber(value));
  }
  if (typeof value === "string") return mixText(mix(hash, 3), value);
  if (typeof value === "boolean") return mix(hash, value ? 4 : 5);
  if (typeof value === "function") return mix(hash, 6);
  if (isHandle(value)) return mix(mixName(mix(hash, 7), value.kind), value.id);
  return mix(hash, value === undefined || value === null ? 8 : 9);
}
