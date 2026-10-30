import { Effect } from "effect";
import { MapBuildFailure } from "../process/hostProcess";

/** Holds an exclusive `flock` on `path` until the scope ends, waiting while another holder has it; the lock goes with its holder, even a killed one. */
export const holdLock = (path: string) => Effect.acquireRelease(
  Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn(["flock", "--exclusive", "--no-fork", path, "sh", "-c", "echo held; exec cat >/dev/null"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
      const reader = child.stdout.getReader();
      await reader.read();
      reader.releaseLock();
      return child;
    },
    catch: (cause) => new MapBuildFailure({ operation: "lock", path, cause }),
  }),
  (child) => Effect.sync(() => child.kill()),
);
