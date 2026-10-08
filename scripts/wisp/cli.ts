// A project's command-line program: it picks one of the project's commands by
// name, runs it with step timings on stderr, and turns its failure into a
// message and exit code.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Cause, Effect, Exit, Option } from "effect";
import type { Command } from "./command";
import { step, timingsLayer } from "./timings";

export interface CommandEntry {
  /** The arguments after the command name, as the usage line shows them. */
  readonly usage: string;
  /** Loads the command on demand, so a run loads only the modules its command uses. */
  readonly load: () => Promise<Command>;
}

/** Runs `NAME ARGS...` from `argv`; succeeds with 0, 1 for a failed command or 2 for a usage problem. */
export const cliProgram = (program: string, commands: Readonly<Record<string, CommandEntry>>, argv: readonly string[], print: (line: string) => void = console.error) => Effect.gen(function*() {
  const [name, ...args] = argv;
  const entry = name === undefined ? undefined : commands[name];
  if (name === undefined || entry === undefined) {
    print(`usage: ${program} COMMAND\n${Object.entries(commands).map(([command, { usage }]) => `  ${[command, usage].join(" ").trim()}`).join("\n")}`);
    return 2;
  }
  const command = yield* Effect.promise(() => entry.load());
  const exit = yield* Effect.exit(command(args).pipe(step(name), Effect.provide(timingsLayer(print))));
  if (Exit.isSuccess(exit)) return 0;
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) {
    print(Cause.pretty(exit.cause));
    return 1;
  }
  if (failure.value._tag === "UsageFailure") {
    print(`${failure.value.message}\nusage: ${[program, name, entry.usage].join(" ").trim()}`);
    return 2;
  }
  print(failure.value.message);
  return 1;
});

/** `cliProgram` as a promise of its exit code. */
export const runCli = (...args: Parameters<typeof cliProgram>): Promise<number> => Effect.runPromise(cliProgram(...args));

/**
 * A project's `bun` entry point: runs `cliProgram` under BunRuntime.runMain,
 * so Ctrl-C or SIGTERM interrupts the command and closes its scopes (stopping
 * its processes) before the program exits with 130.
 */
export const runMainCli = (program: string, commands: Readonly<Record<string, CommandEntry>>, argv: readonly string[]) =>
  BunRuntime.runMain(cliProgram(program, commands, argv), {
    disableErrorReporting: true,
    teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : Cause.hasInterruptsOnly(exit.cause) ? 130 : 1),
  });
