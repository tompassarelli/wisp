









import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, Exit, Fiber, FileSystem, Scope, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { spawnLogged } from "../hostProcess";
import { LanFailure } from "./join";
import { poolProfile, desktopSize, pairDirectory } from "./pool";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const profileName = argument("pool-profile") ?? "parity";
const launcher = argument("launcher");
const capacity = argument("capacity");
if (capacity === undefined) throw new Error("pairSession requires --capacity MACHINE_CAPACITY_HELPER");
const fpsText = argument("fps");
const profile = poolProfile(profileName, fpsText === undefined ? undefined : Number(fpsText));
if (launcher === undefined) throw new Error("pairSession takes --pair K --pool-profile parity|visual --launcher PRIVATE_DESKTOP_SH");
const directory = pairDirectory(pair);
mkdirSync(directory, { recursive: true });
const size = desktopSize(profile);

const session = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const ready = yield* Deferred.make<string, LanFailure>();
  const desktopBScope = yield* Scope.fork(yield* Effect.scope);
  const desktopB = yield* ChildProcess.make(launcher, ["start", "--resolution", size], { stdin: "ignore", forceKillAfter: "15 seconds" }).pipe(Scope.provide(desktopBScope));
  const desktopBError = yield* Effect.forkScoped(Stream.run(desktopB.stderr, fs.sink(join(directory, "desktop-b.err"))));
  let text = "";
  const desktopBOutput = yield* Effect.forkScoped(Stream.runForEach(Stream.decodeText(desktopB.stdout), (chunk) => Effect.gen(function*() {
    text += chunk;
    const run = /^Run: (.+)$/m.exec(text)?.[1]?.trim();
    if (run !== undefined) yield* Deferred.succeed(ready, run);
  })).pipe(Effect.andThen(Deferred.fail(ready, new LanFailure({ problem: `client b's desktop didn't start: ${text.trim()}` })))));
  yield* Effect.addFinalizer(() => Scope.close(desktopBScope, Exit.void).pipe(Effect.andThen(Effect.all([Fiber.await(desktopBOutput), Fiber.await(desktopBError)], { discard: true }))));
  const runB = yield* Deferred.await(ready).pipe(Effect.timeoutOrElse({ duration: "120 seconds", orElse: () => Effect.fail(new LanFailure({ problem: "client b's desktop didn't report its Run line within 120 seconds" })) }));
  if (!existsSync(join(runB, "active"))) return yield* new LanFailure({ problem: `client b's desktop isn't active: ${runB}` });
  yield* Effect.tryPromise({ try: () => Bun.write(join(directory, "desktop-b.run"), runB), catch: (cause) => new LanFailure({ problem: String(cause) }) });
  const desktopA = yield* spawnLogged(ChildProcess.make(launcher, ["start", "--resolution", size, "--", "bwrap", "--dev-bind", "/", "/", "--unshare-net", "--die-with-parent", "--",
    process.execPath, join(import.meta.dir, "pairAgent.ts"), "--pair", String(pair), "--pool-profile", profileName, "--run-b", runB, "--session-pid", String(process.pid), "--capacity", capacity, ...(fpsText === undefined ? [] : ["--fps", fpsText])], {
    stdin: "ignore", forceKillAfter: "15 seconds",
  }), { stdout: join(directory, "desktop-a.out"), stderr: join(directory, "desktop-a.err") });
  yield* Effect.raceFirst(desktopA.handle.exitCode, desktopB.exitCode);
});

BunRuntime.runMain(Effect.scoped(session).pipe(Effect.provide(BunServices.layer)));
