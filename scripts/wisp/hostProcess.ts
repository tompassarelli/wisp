// Child processes for host tools (wisp:docs/host-tools.md). Start them with
// Effect's ChildProcess (`effect/process`), provided by
// `@effect/platform-bun/BunServices`: each child runs in its own process group
// tied to the current Scope, and closing the scope (success, failure,
// interrupt, or SIGINT/SIGTERM through BunRuntime.runMain) sends the group
// SIGTERM and waits for it to exit.
import { Effect, Fiber, FileSystem, Stream } from "effect";
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
  const handle = yield* command;
  const stdout = yield* Effect.forkScoped(Stream.run(handle.stdout, fs.sink(files.stdout)));
  const stderr = yield* Effect.forkScoped(Stream.run(handle.stderr, fs.sink(files.stderr)));
  const written = Effect.all([Fiber.await(stdout), Fiber.await(stderr)], { discard: true });
  return { handle, written };
});
