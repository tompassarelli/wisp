

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


export function flagValues(args: readonly string[], name: string): string[] {
  const flag = `--${name}`;
  return args.flatMap((arg, index) => {
    if (arg.startsWith(`${flag}=`)) return [arg.slice(flag.length + 1)];
    const value = args[index + 1];
    return arg === flag && value !== undefined && !value.startsWith("--") ? [value] : [];
  });
}
