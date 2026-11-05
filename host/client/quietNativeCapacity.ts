import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, FileSystem, Schedule, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { capacityCommand, capacityProgram, capacitySpawn } from "../process/capacityHost";
import { spawnLogged } from "../process/hostProcess";

class QuietLeaseFailure extends Schema.TaggedError<QuietLeaseFailure, { readonly brand: unique symbol }>()("QuietLeaseFailure", {
  problem: Schema.String,
}) {
  override get message(): string { return this.problem; }
}

export const quietNativeSessionArgs = (program: string, owner: string) => [
  ...capacityCommand(program), "session", "--class", "native", "--new-clients", "0", "--quiet", "--memory-gib", "1", "--owner", owner,
  "--", process.execPath, "-e", "setInterval(() => {}, 60_000)",
] as const;

export const withQuietNativeCapacity = <A, E, R>(owner: string, run: Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
  const program = capacityProgram();
  if (program === undefined) return yield* run;
  const fs = yield* FileSystem.FileSystem;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "wisp-native-quiet-" }).pipe(Effect.mapError((cause) => new QuietLeaseFailure({ problem: String(cause) })));
  const stdout = join(folder, "stdout");
  const child = yield* spawnLogged(ChildProcess.make(...capacitySpawn(program, quietNativeSessionArgs(program, owner).slice(3)), { stdin: "ignore", forceKillAfter: "5 seconds" }), {
    stdout,
    stderr: join(folder, "stderr"),
  }).pipe(Effect.mapError((cause) => new QuietLeaseFailure({ problem: `starting native quiet lease: ${String(cause)}` })));
  const reserved = yield* Effect.gen(function*() {
    const text = yield* Effect.all([
      fs.readFileString(stdout).pipe(Effect.orElseSucceed(() => "")),
      fs.readFileString(join(folder, "stderr")).pipe(Effect.orElseSucceed(() => "")),
    ]).pipe(Effect.map((lines) => lines.join("\n")));
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
