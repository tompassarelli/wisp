import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Scope, Stream } from "effect";
import { platformLayer } from "../../platform/layer";
import { Namespaces } from "../../platform/services";
import { ChildProcess } from "effect/process";
import { flagValues } from "../command";
import { spawnLogged } from "../hostProcess";
import { LanFailure } from "./join";
import { desktopSize, pairDirectory, pairFlags } from "./pool";

const argument = (name: string) => flagValues(process.argv, name)[0];
const { pair, profile } = pairFlags(process.argv);
const launcher = argument("launcher");
const capacity = argument("capacity");
if (capacity === undefined) throw new Error("pairSession requires --capacity MACHINE_CAPACITY_HELPER");
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
  const agent = yield* Namespaces.use((namespaces) => namespaces.offline([
    process.execPath, join(import.meta.dir, "pairAgent.ts"), "--pair", String(pair), "--pool-profile", argument("pool-profile") ?? "parity", "--run-b", runB, "--session-pid", String(process.pid), "--capacity", capacity, ...flagValues(process.argv, "fps").flatMap((fps) => ["--fps", fps])]));
  const desktopA = yield* spawnLogged(ChildProcess.make(launcher, ["start", "--resolution", size, "--", ...agent], {
    stdin: "ignore", forceKillAfter: "15 seconds",
  }), { stdout: join(directory, "desktop-a.out"), stderr: join(directory, "desktop-a.err") });
  yield* Effect.raceFirst(desktopA.handle.exitCode, desktopB.exitCode);
});

BunRuntime.runMain(Effect.scoped(session).pipe(Effect.provide(Layer.merge(BunServices.layer, platformLayer()))));
