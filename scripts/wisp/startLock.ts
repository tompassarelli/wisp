




import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { PlayProblem } from "./play";


export const startLockPath = () => join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local/state"), "wisp/online/client-start.lock");


export const START_LOCK_SECONDS = 300;

export interface StartLockOptions {
  readonly path: string;

  readonly holder: string;
  readonly seconds?: number;

  readonly noteEvery?: number;
  readonly print: (line: string) => void;
}

const holderOf = (path: string) => {
  try {
    return readFileSync(`${path}.holder`, "utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
};





export const acquireStartLock = ({ path, holder, seconds = START_LOCK_SECONDS, noteEvery = 10, print }: StartLockOptions) => Effect.gen(function*() {
  yield* Effect.try({ try: () => mkdirSync(dirname(path), { recursive: true }), catch: (cause) => new PlayProblem({ problem: `create ${dirname(path)}: ${String(cause)}` }) });
  const child = yield* Effect.try({
    try: () => Bun.spawn(["flock", "--exclusive", "--no-fork", path, "sh", "-c", `echo held; exec sleep ${seconds}`], { stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
    catch: (cause) => new PlayProblem({ problem: `flock ${path}: ${String(cause)}` }),
  });
  let held = false;
  child.stdout.getReader().read().then(({ done }) => {
    held = !done;
  }, () => {});
  const waited = yield* Effect.gen(function*() {
    let ticks = 0;

    while (!held) {
      if (child.exitCode !== null) return yield* new PlayProblem({ problem: `flock ${path} exited ${child.exitCode}: ${(yield* Effect.promise(() => new Response(child.stderr).text())).trim()}` });
      if (ticks % (noteEvery * 4) === 1) print(`waiting to start: another client is starting (${holderOf(path)}); clients start one at a time`);
      ticks++;
      yield* Effect.sleep("250 millis");
    }
    return ticks;
  }).pipe(Effect.onInterrupt(() => Effect.sync(() => child.kill())), Effect.tapError(() => Effect.sync(() => child.kill())));
  yield* Effect.try({
    try: () => writeFileSync(`${path}.holder`, `${holder} (pid ${process.pid}, since ${new Date().toISOString()})\n`),
    catch: (cause) => new PlayProblem({ problem: `write ${path}.holder: ${String(cause)}` }),
  }).pipe(Effect.tapError(() => Effect.sync(() => child.kill())));
  if (waited > 1) print("start lock taken");
  // @effect-diagnostics-next-line returnEffectInGen:off -- the caller runs this release action later, so it is returned, not run
  return Effect.sync(() => {
    if (child.exitCode !== null) print(`start lock had already been released after its ${seconds} s timeout`);
    else child.kill();
  });
});
