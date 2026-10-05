// Child processes of the dev loop (wisp:docs/dev.md). A process that takes
// its work on stdin starts before the save that uses it, so a save pays only
// for loading the project's code and running it. Each process runs once;
// interrupting its effect kills and reaps it.
import type { Subprocess } from "bun";
import { Effect } from "effect";
import { RESULT_PREFIX } from "./devResult";

export interface ProcessOutput {
  readonly exitCode: number;
  /** The JSON values of the process's result lines. */
  readonly results: readonly unknown[];
  /** Everything else it wrote, stdout then stderr. */
  readonly output: string;
}

type Child = Subprocess<"pipe", "pipe", "pipe">;

const spawn = (command: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>>): Child =>
  Bun.spawn([...command], { cwd, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });

const collect = async (child: Child): Promise<ProcessOutput> => {
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const results: unknown[] = [];
  const other: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith(RESULT_PREFIX)) results.push(JSON.parse(line.slice(RESULT_PREFIX.length)));
    else if (line.length > 0) other.push(line);
  }
  return { exitCode, results, output: [...other, stderr.trimEnd()].filter((text) => text.length > 0).join("\n") };
};

const reap = (child: Child) => Effect.promise(async () => {
  if (child.exitCode === null) child.kill("SIGKILL");
  await child.exited;
});

/** Runs a command to completion and captures its output; interruption kills it. */
export const runProcess = (command: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>> = {}) =>
  Effect.acquireUseRelease(
    Effect.sync(() => spawn(command, cwd, env)),
    (child) => Effect.promise(async () => {
      await child.stdin.end();
      return collect(child);
    }),
    reap,
  );

/** Processes started ahead of the work they will be given on stdin. */
export class Standby {
  private readonly ready: Child[] = [];
  private closed = false;

  constructor(
    private readonly command: readonly string[],
    private readonly cwd: string,
    private readonly count: number,
    private readonly env: Readonly<Record<string, string | undefined>> = {},
  ) {
    this.refill();
  }

  /**
   * Gives `request` to a waiting process and collects what it prints;
   * interruption kills it. Its replacement starts when it ends, so starting
   * it takes nothing from the save that uses this one.
   */
  run(request: unknown): Effect.Effect<ProcessOutput> {
    return Effect.acquireUseRelease(
      Effect.sync(() => this.ready.shift() ?? spawn(this.command, this.cwd, this.env)),
      (child) => Effect.promise(async () => {
        child.stdin.write(`${JSON.stringify(request)}\n`);
        await child.stdin.end();
        return collect(child);
      }),
      (child) => reap(child).pipe(Effect.ensuring(Effect.sync(() => this.refill()))),
    );
  }

  /** Stops every waiting process. */
  close(): void {
    this.closed = true;
    for (const child of this.ready.splice(0)) child.kill("SIGKILL");
  }

  private refill(): void {
    while (!this.closed && this.ready.length < this.count) this.ready.push(spawn(this.command, this.cwd, this.env));
  }
}
