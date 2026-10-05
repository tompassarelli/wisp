// What a Wisp command is: a program for its arguments, with the services it
// uses provided. The consuming project selects its commands.
import type { Effect } from "effect";
import { Schema } from "effect";

/** Arguments a command can't run with; Wisp prints the command's usage. */
export class UsageFailure extends Schema.TaggedError<UsageFailure>()("UsageFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

/** Every failure a command reports is a tagged error with a message. */
export interface CommandFailure {
  readonly _tag: string;
  readonly message: string;
}

export type Command = (args: readonly string[]) => Effect.Effect<void, CommandFailure>;

/** Readable text for a failure's cause: a process's stderr, a thrown error, a Schema issue. */
export function describeCause(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** Values of each `--name value` pair; flags without a value are left out. */
export function flagValues(args: readonly string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] !== undefined ? [args[index + 1]!] : []));
}
