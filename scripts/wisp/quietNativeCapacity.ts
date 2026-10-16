import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, FileSystem, Schedule, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { capacityHelper } from "./gpuLease";
import { spawnLogged } from "./hostProcess";

class QuietLeaseFailure extends Schema.TaggedError<QuietLeaseFailure>()("QuietLeaseFailure", {
  problem: Schema.String,
}) {
  override get message(): string { return this.problem; }
}

export const quietNativeSessionArgs = (helper: string, owner: string) => [
  helper, "session", "--class", "native", "--quiet", "--memory-gib", "1", "--owner", owner,
  "--", process.execPath, "-e", "setInterval(() => {}, 60_000)",
] as const;

export const withQuietNativeCapacity = <A, E, R>(owner: string, run: Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
  const helper = yield* capacityHelper.pipe(Effect.provide(BunServices.layer));
  if (helper === undefined) return yield* run;
  const fs = yield* FileSystem.FileSystem;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "wisp-native-quiet-" }).pipe(Effect.mapError((cause) => new QuietLeaseFailure({ problem: String(cause) })));
  const stdout = join(folder, "stdout");
  const child = yield* spawnLogged(ChildProcess.make(process.execPath, [helper, ...quietNativeSessionArgs(helper, owner).slice(1)], { stdin: "ignore", forceKillAfter: "5 seconds" }), {
    stdout,
    stderr: join(folder, "stderr"),
  }).pipe(Effect.mapError((cause) => new QuietLeaseFailure({ problem: `starting native quiet lease: ${String(cause)}` })));
  const reserved = yield* Effect.gen(function*() {
    const text = yield* fs.readFileString(stdout).pipe(Effect.orElseSucceed(() => ""));
    if (text.split("\n").some((line) => {
      try { return JSON.parse(line).decision === "RESERVED"; } catch { return false; }
    })) return true;
    const exit = yield* child.handle.exitCode.pipe(Effect.timeoutOption("1 millis"));
    if (exit._tag === "Some") {
      const error = yield* fs.readFileString(join(folder, "stderr")).pipe(Effect.orElseSucceed(() => ""));
      return yield* new QuietLeaseFailure({ problem: `native quiet lease exited ${Number(exit.value)} before RESERVED: ${error.trim()}` });
    }
    return false;
  }).pipe(Effect.repeat({ schedule: Schedule.spaced("50 millis"), until: Boolean }));
  if (!reserved) return yield* new QuietLeaseFailure({ problem: "native quiet lease ended before RESERVED" });
  return yield* run;
})).pipe(Effect.provide(BunServices.layer));
