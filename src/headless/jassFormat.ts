import { describeNumber } from "../game/native/textFormat";
import type { Handle } from "../game/native/types";
import type { NativeCall } from "./clientTypes";

export const isHandle = (value: unknown): value is Handle =>
  typeof value === "object" && value !== null && "id" in value && "kind" in value;

export function describeValue(value: unknown): string {
  if (value === undefined || value === null) return "nil";
  if (typeof value === "number") return describeNumber(value);
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "function") return "fn";
  if (isHandle(value)) return `${value.kind}#${describeNumber(value.id)}`;
  return "table";
}

export function describeCall({ name, args }: NativeCall): string {
  let call = `${name}(`;
  for (let index = 0; index < args.length; index++) {
    if (index > 0) call += ", ";
    call += describeValue(args[index]);
  }
  return `${call})`;
}

export function sameCall(left: NativeCall, right: NativeCall): boolean {
  if (left.name !== right.name || left.args.length !== right.args.length) return false;
  for (let index = 0; index < left.args.length; index++) {
    const leftArg = left.args[index];
    const rightArg = right.args[index];
    if (leftArg === rightArg) continue;
    if (typeof leftArg === "function" && typeof rightArg === "function") continue;
    if (isHandle(leftArg) && isHandle(rightArg)) {
      if (leftArg.id !== rightArg.id || leftArg.kind !== rightArg.kind) return false;
      continue;
    }
    if (describeValue(leftArg) !== describeValue(rightArg)) return false;
  }
  return true;
}
