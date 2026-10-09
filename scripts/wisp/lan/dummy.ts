import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cause, Effect, Schedule } from "effect";
import { startHost, type LanHost } from "./host";
import { LanFailure } from "./join";
import type { MapFacts } from "./map";

interface DummyOptions<E, R> {
  readonly program: string;
  readonly map: MapFacts;
  readonly count: number;
  readonly output: string;
  readonly nativeVersion?: string;
  readonly joinNative: (host: LanHost, gameName: string) => Effect.Effect<void, E, R>;
  readonly announcePorts?: readonly number[];
}

const failure = (cause: unknown) => new LanFailure({ problem: cause instanceof Error ? cause.message : String(cause) });
const until = (ready: () => boolean, description: string) => Effect.sync(ready).pipe(
  Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (held) => held }),
  Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail(new LanFailure({ problem: `timed out waiting for ${description}` })) }),
);
const residentKiB = (pid: number) => {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  return Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
};


export const checkDummy = <E, R>(options: DummyOptions<E, R>) => Effect.suspend(() => {
  const started = performance.now();
  let step = "host startup";
  let setupMs: number | undefined;
  const runs: { joinMs: number; wallMs: number; cpuMs: number; cpuCores: number; rssKiB: number }[] = [];
  const result = () => ({ protocolVersion: 10200, nativeVersion: options.nativeVersion, program: options.program, completed: runs.length, setupMs: setupMs ?? performance.now() - started, runs });
  return Effect.scoped(Effect.gen(function*() {
    yield* Effect.try({ try: () => mkdirSync(options.output, { recursive: true }), catch: failure });
    const lines: string[] = [];
    const packets = join(options.output, "packets.log");
    yield* Effect.try({ try: () => writeFileSync(packets, ""), catch: failure });
    const gameName = `wisp-dummy-${Date.now()}`;
    const host = yield* startHost({
      map: options.map, clients: ["native", "dummy"], gameName, autoStart: false,
      ...(options.announcePorts === undefined ? {} : { announcePorts: options.announcePorts }),
      log: (line) => { lines.push(line); appendFileSync(join(options.output, "actions.log"), `${line}\n`); },
      onPacket: (direction, label, bytes) => appendFileSync(packets, `${performance.now().toFixed(3)} ${direction} ${label} ${Buffer.from(bytes).toString("hex")}\n`),
    });
    const nativePid = host.slots().slots.find((slot) => slot.status === 0)?.color;
    if (nativePid !== 0) return yield* new LanFailure({ problem: "the upstream command requires the real player in player slot 1" });
    step = "native lobby join";
    yield* options.joinNative(host, gameName);
    step = "native map check";
    yield* until(() => host.status().players[0]?.connected === true && lines.some((line) => line.includes("map native has it")), "the native player's map check");
    setupMs = performance.now() - started;
    for (let index = 0; index < options.count; index++) {
      yield* Effect.scoped(Effect.gen(function*() {
        const before = lines.length;
        const started = performance.now();
        step = `dummy ${index + 1} startup`;

        const run = yield* Effect.acquireRelease(Effect.try({ try: () => {
          const child = Bun.spawn([options.program, "-v", "10200", "-dial=false", "-n", `dummy${index + 1}`, "127.0.0.1", String(host.port)], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
          return { child, stdout: new Response(child.stdout).text(), stderr: new Response(child.stderr).text() };
        }, catch: failure }), (run) => Effect.gen(function*() {
          if (run.child.exitCode === null) run.child.kill("SIGTERM");
          yield* Effect.promise(() => run.child.exited).pipe(Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.promise(() => { run.child.kill("SIGKILL"); return run.child.exited; }) }));
          const [out, err] = yield* Effect.promise(() => Promise.all([run.stdout, run.stderr]));
          yield* Effect.sync(() => writeFileSync(join(options.output, `dummy-${index + 1}.log`), out + err));
        }));
        const child = run.child;
        step = `dummy ${index + 1} map check`;
        yield* until(() => lines.slice(before).some((line) => line.includes("map dummy has it")), "the dummy's map check");
        const joinMs = performance.now() - started;
        const dummyPid = host.status().players[1]?.pid;
        if (dummyPid === undefined) return yield* new LanFailure({ problem: "the dummy has no player slot" });
        host.say(1, dummyPid, ".handicap 90");
        step = `dummy ${index + 1} handicap change`;
        yield* until(() => host.slots().slots.some((slot) => slot.playerId === dummyPid && slot.handicap === 90), "handicap 90");
        yield* Effect.sleep("250 millis");
        const rssKiB = yield* Effect.try({ try: () => residentKiB(child.pid), catch: failure });
        host.say(1, dummyPid, ".leave");
        step = `dummy ${index + 1} leave`;
        yield* until(() => host.status().players[1]?.connected === false, "the dummy to leave");
        child.stdin.end();
        yield* Effect.tryPromise({ try: () => child.exited, catch: failure }).pipe(Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail(new LanFailure({ problem: "timed out waiting for the dummy to exit" })) }));
        const wallMs = performance.now() - started;
        const resources = child.resourceUsage();
        if (resources === undefined) return yield* new LanFailure({ problem: "the dummy's CPU usage is unavailable" });
        const cpuMs = Number(resources.cpuTime.total) / 1000;
        const [out, err] = yield* Effect.tryPromise({ try: () => Promise.all([run.stdout, run.stderr]), catch: failure });
        if (err.includes("[ERROR]") || out.includes("[ERROR]")) return yield* new LanFailure({ problem: `dummy ${index + 1} reported a protocol error; see its log and ${packets}` });
        runs.push({ joinMs, wallMs, cpuMs, cpuCores: cpuMs / wallMs, rssKiB });
        console.log(`dummy ${index + 1}/${options.count}: joined in ${joinMs.toFixed(1)} ms, handicap 90, left`);
      }));
    }
    const passed = { ...result(), status: "passed", unexplainedFailures: 0 };
    yield* Effect.try({ try: () => writeFileSync(join(options.output, "result.json"), `${JSON.stringify(passed, null, 2)}\n`), catch: failure });
    return passed;
  })).pipe(Effect.tapCause((cause) => Effect.try({
    try: () => writeFileSync(join(options.output, "result.json"), `${JSON.stringify({ ...result(), status: "failed", failedStep: step, problem: Cause.pretty(cause) }, null, 2)}\n`),
    catch: failure,
  })));
});
