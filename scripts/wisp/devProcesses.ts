import type { Subprocess } from "bun";
import { Effect, Schema, type Scope } from "effect";
import { describeCause } from "./command";
import { RESULT_PREFIX } from "./devResult";

export interface ProcessOutput {
  readonly exitCode: number;

  readonly results: readonly unknown[];

  readonly output: string;
}

export class DevProcessFailure extends Schema.TaggedError<DevProcessFailure>()("DevProcessFailure", {
  command: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.command}: ${this.problem}`;
  }
}

type Child = Subprocess<"pipe", "pipe", "pipe">;

const ResultLine = Schema.fromJsonString(Schema.Unknown);

const spawn = (command: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>>): Effect.Effect<Child> =>
  Effect.sync((): Child => Bun.spawn([...command], { cwd, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" }));

const collect = (command: readonly string[], child: Child, input?: string) => Effect.gen(function*() {
  const failure = (problem: string) => new DevProcessFailure({ command: command.join(" "), problem });
  const [exitCode, stdout, stderr] = yield* Effect.tryPromise({
    try: async () => {
      if (input !== undefined) child.stdin.write(input);
      await child.stdin.end();
      return Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    },
    catch: (cause) => failure(describeCause(cause)),
  });
  const results: unknown[] = [];
  const other: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith(RESULT_PREFIX)) {
      results.push(yield* Schema.decodeEffect(ResultLine)(line.slice(RESULT_PREFIX.length)).pipe(
        Effect.mapError((issue) => failure(`result line isn't JSON: ${issue.message}`)),
      ));
    } else if (line.length > 0) other.push(line);
  }
  return { exitCode, results, output: [...other, stderr.trimEnd()].filter((text) => text.length > 0).join("\n") } satisfies ProcessOutput;
});

const reap = (child: Child) => Effect.promise(async () => {
  if (child.exitCode === null) child.kill("SIGKILL");
  await child.exited;
});

export const runProcess = (command: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>> = {}) =>
  Effect.acquireUseRelease(
    spawn(command, cwd, env),
    (child) => collect(command, child),
    reap,
  );

export class Standby {
  private readonly ready: Child[] = [];
  private closed = false;

  static make(command: readonly string[], cwd: string, count: number, env: Readonly<Record<string, string | undefined>> = {}): Effect.Effect<Standby, never, Scope.Scope> {
    return Effect.acquireRelease(Effect.sync(() => new Standby(command, cwd, count, env)).pipe(Effect.tap((standby) => standby.refill)), (standby) => standby.close);
  }

  private constructor(
    private readonly command: readonly string[],
    private readonly cwd: string,
    private readonly count: number,
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  run(request: unknown): Effect.Effect<ProcessOutput, DevProcessFailure> {
    return Effect.acquireUseRelease(
      Effect.suspend(() => {
        const ready = this.ready.shift();
        return ready === undefined ? spawn(this.command, this.cwd, this.env) : Effect.succeed(ready);
      }),
      (child) => collect(this.command, child, `${JSON.stringify(request)}\n`),
      (child) => reap(child).pipe(Effect.ensuring(this.refill)),
    );
  }

  private readonly close = Effect.suspend(() => {
    this.closed = true;
    return Effect.forEach(this.ready.splice(0), reap, { concurrency: "unbounded", discard: true });
  });

  private readonly refill: Effect.Effect<void> = Effect.suspend(() => this.closed || this.ready.length >= this.count
    ? Effect.void
    : spawn(this.command, this.cwd, this.env).pipe(Effect.flatMap((child) => {
      this.ready.push(child);
      return this.refill;
    })));
}
