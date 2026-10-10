import type { Effect } from "effect";
import { Schema } from "effect";
import type { Platform } from "../platform/services";

export class UsageFailure extends Schema.TaggedError<UsageFailure>()("UsageFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

export interface CommandFailure {
  readonly _tag: string;
  readonly message: string;
}

export type Command = (args: readonly string[]) => Effect.Effect<void, CommandFailure, Platform>;

export function describeCause(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** An error's stack (or message), cut to its first `lines` lines and joined by `separator`. */
export function describeStack(cause: unknown, lines = Number.POSITIVE_INFINITY, separator = "\n"): string {
  if (!(cause instanceof Error)) return String(cause);
  return (cause.stack ?? cause.message).split("\n").slice(0, lines).join(separator);
}

export function flagValues(args: readonly string[], name: string): string[] {
  const flag = `--${name}`;
  return args.flatMap((arg, index) => {
    if (arg.startsWith(`${flag}=`)) return [arg.slice(flag.length + 1)];
    const value = args[index + 1];
    return arg === flag && value !== undefined && !value.startsWith("--") ? [value] : [];
  });
}

interface WholeFlag {
  readonly min?: number;
  readonly max?: number;
}

/** `--NAME N`'s whole number from `min` (0) to `max`, or `fallback` when the flag is absent. */
export function wholeFlag(args: readonly string[], name: string, options: WholeFlag & { readonly fallback: number }): number | UsageFailure;
export function wholeFlag(args: readonly string[], name: string, options?: WholeFlag & { readonly fallback?: number }): number | undefined | UsageFailure;
export function wholeFlag(args: readonly string[], name: string, { fallback, min = 0, max }: WholeFlag & { readonly fallback?: number } = {}): number | undefined | UsageFailure {
  const [text] = flagValues(args, name);
  if (text === undefined && !args.includes(`--${name}`)) return fallback;
  const value = Number(text);
  if (text !== undefined && Number.isSafeInteger(value) && value >= min && (max === undefined || value <= max)) return value;
  const kind = max !== undefined ? `a whole number from ${min} to ${max}` : min === 0 ? "a whole number" : min === 1 ? "a positive whole number" : `a whole number of at least ${min}`;
  return new UsageFailure({ problem: `--${name} takes ${kind}` });
}

/** `--port N`, a TCP or UDP port; `min: 0` lets the system choose one. */
export function portFlag(args: readonly string[], fallback: number, { min = 1 }: { readonly min?: 0 | 1 } = {}): number | UsageFailure {
  const [text = String(fallback)] = flagValues(args, "port");
  const port = Number(text);
  return Number.isInteger(port) && port >= min && port <= 65535 ? port : new UsageFailure({ problem: `--port takes a port number, not ${text}` });
}
