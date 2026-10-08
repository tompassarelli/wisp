// The machine's client start-up lock (wisp:docs/doctor.md, "One start at a
// time"): one Warcraft III client at a time goes from starting Battle.net or
// the game to its menus. On 8 Oct clone-a crashed 1.8 s after clone-d's game
// started beside it. The lock is an flock(1) held by a `sleep` that outlives
// no more than the timeout, so a starter that dies or hangs frees it anyway.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { PlayProblem } from "./play";

/** The one lock file for the machine. */
export const startLockPath = () => join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local/state"), "wisp/online/client-start.lock");

/** A start holds the lock this long at most: Battle.net, its sign-in and the game reached the menus in 97 s on 8 Oct. */
export const START_LOCK_SECONDS = 300;

export interface StartLockOptions {
  readonly path: string;
  /** Who is starting, as the waiting starters print it. */
  readonly holder: string;
  readonly seconds?: number;
  /** How often a waiting starter prints who holds the lock. */
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

/**
 * Waits for the start lock, printing who holds it, then holds it until the
 * returned release runs or `seconds` pass, whichever comes first.
 */
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
    // flock reports a free lock within milliseconds; only a start still waiting after the first tick says so.
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
  return Effect.sync(() => {
    if (child.exitCode !== null) print(`start lock had already been released after its ${seconds} s timeout`);
    else child.kill();
  });
});
