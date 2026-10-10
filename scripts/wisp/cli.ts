import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { platformLayer } from "../platform/layer";
import type { Platform } from "../platform/services";
import type { Command } from "./command";
import { step, timingsLayer } from "./timings";

export interface CommandEntry {

  readonly usage: string;

  readonly load: () => Promise<Command>;
}

export const cliProgram = (program: string, commands: Readonly<Record<string, CommandEntry>>, argv: readonly string[], print: (line: string) => void = console.error, platform: Layer.Layer<Platform> = platformLayer()) => Effect.gen(function*() {
  const [name, ...args] = argv;
  const entry = name === undefined ? undefined : commands[name];
  if (name === undefined || entry === undefined) {
    print(`usage: ${program} COMMAND\n${Object.entries(commands).map(([command, { usage }]) => `  ${[command, usage].join(" ").trim()}`).join("\n")}`);
    return 2;
  }
  const command = yield* Effect.promise(() => entry.load());
  const exit = yield* Effect.exit(command(args).pipe(step(name), Effect.provide(Layer.merge(timingsLayer(print), platform))));
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

export const runCli = (...args: Parameters<typeof cliProgram>): Promise<number> => Effect.runPromise(cliProgram(...args));

export const runMainCli = (program: string, commands: Readonly<Record<string, CommandEntry>>, argv: readonly string[]) =>
  BunRuntime.runMain(cliProgram(program, commands, argv), {
    disableErrorReporting: true,
    teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : Cause.hasInterruptsOnly(exit.cause) ? 130 : 1),
  });
