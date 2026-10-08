# Host tools

Host tools are the programs Bun runs on this machine: commands, runners,
builds, captures and farm jobs. When one starts processes, waits, retries,
holds a resource or reads outside data, it is an Effect program built from
Effect's own pieces. Four rules:

1. **Children belong to a scope.** Start child processes with Effect's
   `ChildProcess` (`import { ChildProcess, ChildProcessSpawner } from
   "effect/process"`), provided by `BunServices.layer`
   (`@effect/platform-bun/BunServices`). Each child runs in its own process
   group, and closing its scope sends the group SIGTERM and waits for it
   (`forceKillAfter` adds SIGKILL after a bound). The scope closes on success,
   failure, interruption, and SIGINT or SIGTERM. Hold sockets, servers,
   watchers and timers the same way, with `Effect.acquireRelease` or
   `Effect.forkScoped`. To write a child's output to files, use `spawnLogged`
   (wisp:scripts/wisp/hostProcess.ts).
2. **The entry point runs under `runMain`.** A project's `bun` entry calls
   `runMainCli` (wisp:scripts/wisp/cli.ts), and a standalone script calls
   `BunRuntime.runMain` (`@effect/platform-bun/BunRuntime`). Ctrl-C or a kill
   signal then interrupts the program and runs its cleanup before it exits.
   Don't add `process.on("SIGTERM")` handlers or call `process.exit` from
   inside a program.
3. **Waits and retries use `Schedule` with a deadline.** Poll with
   `Effect.repeat({ schedule: Schedule.spaced(...), until })` and bound it
   with `Effect.timeout`, `Effect.timeoutOption` or `Effect.timeoutOrElse`.
   Retry only failures that can recover, with `Effect.retry({ schedule,
   while })`, bounded by `Schedule.upTo` or `times`.
4. **Outside data is decoded, and failures are tagged.** Read files, replies
   and request bodies with `Schema.decodeUnknownEffect`, using
   `Schema.fromJsonString` for JSON text. Failures are `Schema.TaggedError`
   classes such as `LanFailure` or `WatchFailure`, not strings or thrown
   `Error`s. A wait that times out says it timed out.

If `ChildProcess` can't do something a tool needs, such as starting a process
inside a network namespace or on a private desktop, write the smallest wrapper
over it in one module, with one comment saying why.

## Examples
