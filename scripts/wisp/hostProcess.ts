// Child processes for host tools (wisp:docs/host-tools.md). Start them with
// Effect's ChildProcess (`effect/process`), provided by
// `@effect/platform-bun/BunServices`: each child runs in its own process group
// tied to the current Scope, and closing the scope (success, failure,
// interrupt, or SIGINT/SIGTERM through BunRuntime.runMain) sends the group
// SIGTERM and waits for it to exit.
import { Duration, Effect, Exit, Fiber, FileSystem, Option, Schedule, Scope, Stream } from "effect";
import { ChildProcess } from "effect/process";

export interface LogFiles {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Starts `command` in the current scope with its output written to two files.
 * ChildProcess can only pipe, inherit or ignore a child's output, so fibers in
 * the same scope drain the pipes into the files; `written` waits until both
 * pipes have closed and every byte is on disk.
 */
export const spawnLogged = (command: ChildProcess.Command, files: LogFiles) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const childScope = yield* Scope.fork(yield* Effect.scope);
  const handle = yield* command.pipe(Scope.provide(childScope));
  const stdout = yield* Effect.forkScoped(Stream.run(handle.stdout, fs.sink(files.stdout)));
  const stderr = yield* Effect.forkScoped(Stream.run(handle.stderr, fs.sink(files.stderr)));
  const written = Effect.all([Fiber.await(stdout), Fiber.await(stderr)], { discard: true });
  // Keep both readers alive while the child reports its shutdown and exits.
  yield* Effect.addFinalizer(() => Scope.close(childScope, Exit.void).pipe(Effect.andThen(written)));
  return { handle, written };
});

/** A finished child's exit code and output. */
export interface Collected {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/**
 * Runs `command` to completion in a scope of its own and collects its output,
 * so interrupting the step stops and reaps the child. The stdout chunks are
 * zeroed once copied, for commands that print secrets.
 */
export const collect = (command: ChildProcess.Command) => Effect.scoped(Effect.gen(function*() {
  const handle = yield* command;
  const [chunks, stderr, exitCode] = yield* Effect.all([
    Stream.runCollect(handle.stdout),
    Stream.mkString(Stream.decodeText(handle.stderr)),
    handle.exitCode,
  ], { concurrency: "unbounded" });
  const stdout = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    stdout.set(chunk, at);
    at += chunk.length;
    chunk.fill(0);
  }
  return { exitCode, stdout, stderr } satisfies Collected;
}));

/**
 * Repeats `check` every `every` until it returns a value; undefined once
 * `seconds` have passed on the Effect Clock.
 */
export const pollFor = <A, E, R>(seconds: number, every: Duration.Input, check: Effect.Effect<A | undefined, E, R>): Effect.Effect<A | undefined, E, R> =>
  check.pipe(
    Effect.repeat({ schedule: Schedule.spaced(every), until: (value) => value !== undefined }),
    Effect.timeoutOption(Duration.seconds(seconds)),
    Effect.map(Option.getOrUndefined),
  );
