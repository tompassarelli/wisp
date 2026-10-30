import { chmodSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Duration, Effect, Exit, Fiber, FileSystem, Schedule, Schema, Scope, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { describeCause } from "../contract/describeCause";

export interface LogFiles {
  readonly stdout?: string;
  readonly stderr: string;
}

const OUTPUT_GRACE = "5 seconds";

export const spawnLogged = (command: ChildProcess.Command, files: LogFiles) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const childScope = yield* Scope.fork(yield* Effect.scope);
  const handle = yield* command.pipe(Scope.provide(childScope));
  const stdout = files.stdout === undefined ? undefined : yield* Effect.forkScoped(Stream.run(handle.stdout, fs.sink(files.stdout)));
  const stderr = yield* Effect.forkScoped(Stream.run(handle.stderr, fs.sink(files.stderr)));
  const written = Effect.all([stdout === undefined ? Effect.void : Fiber.await(stdout), Fiber.await(stderr)], { discard: true });

  // A descendant that left the child's process group (a session bus, a setsid'd helper) can hold its output open after it exits.
  yield* Effect.addFinalizer(() => Scope.close(childScope, Exit.void).pipe(Effect.andThen(Effect.timeoutOption(written, OUTPUT_GRACE))));
  return { handle, written };
});

export interface Collected {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

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

interface Poll<A> {
  readonly until?: (value: A) => boolean;
  readonly every: Duration.Input;
}

/** Runs `check` every `every` until `until` holds, or until interrupted without one; after `within` it stops and runs `onTimeout` instead. */
export function pollUntil<A, E, R>(check: Effect.Effect<A, E, R>, options: Poll<A>): Effect.Effect<A, E, R>;
export function pollUntil<A, E, R, A2, E2, R2>(check: Effect.Effect<A, E, R>, options: Poll<A> & {
  readonly within: Duration.Input;
  readonly onTimeout: () => Effect.Effect<A2, E2, R2>;
}): Effect.Effect<A | A2, E | E2, R | R2>;
export function pollUntil<A, E, R, A2, E2, R2>(check: Effect.Effect<A, E, R>, options: Poll<A> & {
  readonly within?: Duration.Input;
  readonly onTimeout?: () => Effect.Effect<A2, E2, R2>;
}): Effect.Effect<A | A2, E | E2, R | R2> {
  // Not a copy: this is the one poll that every wait in host/ goes through.
  const polled = check.pipe(Effect.repeat({ schedule: Schedule.spaced(options.every), ...(options.until === undefined ? {} : { until: options.until }) }));
  return options.within === undefined || options.onTimeout === undefined ? polled : polled.pipe(Effect.timeoutOrElse({ duration: options.within, orElse: options.onTimeout }));
}

export const pollFor = <A, E, R>(seconds: number, every: Duration.Input, check: Effect.Effect<A | undefined, E, R>): Effect.Effect<A | undefined, E, R> =>
  // @effect-diagnostics-next-line effectSucceedWithVoid:off -- an undefined result, which Effect.void's void type cannot satisfy
  pollUntil(check, { until: (value) => value !== undefined, every, within: Duration.seconds(seconds), onTimeout: () => Effect.succeed(undefined) });

export class MapBuildFailure extends Schema.TaggedError<MapBuildFailure, { readonly brand: unique symbol }>()("MapBuildFailure", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.path}: ${describeCause(this.cause)}`;
  }
}

export const tryMapPromise = <A>(operation: string, path: string, run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new MapBuildFailure({ operation, path, cause }) });

export const tryMapSync = <A>(operation: string, path: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new MapBuildFailure({ operation, path, cause }) });

export const captureProcess = (
  operation: string,
  path: string,
  command: readonly string[],
  options: { readonly env?: Record<string, string>; readonly stdout?: "pipe" | "ignore"; readonly cwd?: string } = {},
) =>
  Effect.acquireUseRelease(
    tryMapSync(operation, path, () => Bun.spawn([...command], {
      ...options, stdin: "ignore", stdout: options.stdout ?? "pipe", stderr: "pipe",
    })),
    (child) => tryMapPromise(operation, path, async () => {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        child.stdout === null ? "" : new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    }),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }),
  );

export const runProcess = (operation: string, path: string, command: readonly string[], cwd?: string) =>
  captureProcess(operation, path, command, { stdout: "ignore", ...(cwd === undefined ? {} : { cwd }) }).pipe(Effect.flatMap(({ exitCode, stderr }) =>
    exitCode === 0
      ? Effect.void
      : Effect.fail(new MapBuildFailure({ operation, path, cause: `${command[0]} exited with ${exitCode}: ${stderr.trim()}` })),
  ));

export const stageMap = <E>(source: string, destination: string, edit: (staged: string) => Effect.Effect<void, E>) =>
  Effect.acquireUseRelease(
    tryMapSync("stage map", destination, () => {
      const staged = `${destination}.${process.pid}.next`;
      copyFileSync(source, staged);
      chmodSync(staged, 0o644);
      return staged;
    }),
    (staged) => edit(staged).pipe(Effect.andThen(tryMapSync("publish map", destination, () => renameSync(staged, destination)))),
    (staged) => Effect.sync(() => rmSync(staged, { force: true })),
  );

export class ServiceProblem extends Schema.TaggedError<ServiceProblem, { readonly brand: unique symbol }>()("ServiceProblem", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const run = (command: readonly string[]) => Effect.try({
  try: () => {
    const done = Bun.spawnSync([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    return { code: done.exitCode, out: done.stdout.toString().trim(), err: done.stderr.toString().trim() };
  },
  catch: (cause) => new ServiceProblem({ problem: `${command.slice(0, 2).join(" ")}: ${String(cause)}` }),
});

export const skillScript = (skill: string, script: string) => run(["agents", "path", skill]).pipe(
  Effect.flatMap((done) => (done.code === 0 && done.out !== "" ? Effect.succeed(join(dirname(done.out), script)) : Effect.fail(new ServiceProblem({ problem: `agents path ${skill}: ${done.err || `exit ${done.code}`}` })))),
);
