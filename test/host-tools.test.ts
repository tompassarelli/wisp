// Host tools stop everything they started (wisp:docs/host-tools.md): each
// launcher runs with stand-ins for Warcraft, its desktops and the capacity
// helper, and after SIGTERM or a failed step no stand-in process or capacity
// session is left.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { whileStopped } from "../scripts/wisp/lan/join";
import { agentSocket, pairClients, poolFile, reportPort } from "../scripts/wisp/lan/pool";
import { lanObservation } from "../scripts/wisp/watch";

const root = join(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "fixtures/host-tools");
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A run's own state, data and session folders, and the mark every process it starts inherits. */
const sandbox = () => {
  const folder = mkdtempSync(join(tmpdir(), "wisp-host-tools-"));
  const mark = crypto.randomUUID();
  const bin = join(folder, "bin");
  mkdirSync(bin);
  // PipeWire stand-ins: no client sinks are made on this machine's PipeWire.
  writeFileSync(join(bin, "pw-dump"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(bin, "pw-cli"), "#!/bin/sh\nexit 1\n");
  for (const tool of ["pw-dump", "pw-cli"]) chmodSync(join(bin, tool), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    XDG_STATE_HOME: join(folder, "state"),
    XDG_DATA_HOME: join(folder, "data"),
    WISP_XDOTOOL: "/bin/true",
    WISP_TEST_SESSIONS: join(folder, "sessions"),
    WISP_TEST_MARK: mark,
  };
  const marked = () => readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).filter((pid) => {
    try {
      return readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(`WISP_TEST_MARK=${mark}`);
    } catch {
      return false;
    }
  }).map(Number);
  const sessions = () => (existsSync(env.WISP_TEST_SESSIONS) ? readdirSync(env.WISP_TEST_SESSIONS) : []);
  cleanups.push(() => {
    for (const pid of marked()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(folder, { recursive: true, force: true });
  });
  return { env, marked, sessions };
};

const until = async (check: () => boolean, seconds: number, what: string) => {
  for (const deadline = Date.now() + seconds * 1000; !check();) {
    if (Date.now() > deadline) throw new Error(`${what} not within ${seconds} s`);
    await Bun.sleep(100);
  }
};

/** Waits for the runner to exit, then gives orphans a moment to show. */
const leftovers = async (runner: Bun.Subprocess, box: ReturnType<typeof sandbox>) => {
  const code = await Promise.race([runner.exited, Bun.sleep(30_000).then(() => "still running")]);
  await Bun.sleep(500);
  return { code, processes: box.marked().length, sessions: box.sessions().length };
};

const capacity = join(fixtures, "capacity.ts");
const agentPair = 93;
const agent = (box: ReturnType<typeof sandbox>) => Bun.spawn([process.execPath, join(root, "scripts/wisp/lan/pairAgent.ts"), "--pair", String(agentPair), "--capacity", capacity], { env: box.env, stdout: "ignore", stderr: "ignore" });

test("[repro #62] pair agent: SIGTERM while its games start stops them and the agent", async () => {
  const box = sandbox();
  const runner = agent(box);
  // The first game's session and its stand-in game run; the second isn't launched yet.
  await until(() => box.sessions().length === 1 && box.marked().length >= 5, 30, "the first game");
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions }).toEqual({ processes: 0, sessions: 0 });
}, 60_000);

test("[repro #62] pair agent: a step failing after both games started stops them", async () => {
  const box = sandbox();
  // The first client's menu report port is taken, so the agent fails after launching both games.
  const taken = Bun.serve({ hostname: "127.0.0.1", port: reportPort(agentPair, "a"), fetch: () => new Response() });
  cleanups.push(() => taken.stop(true));
  const runner = agent(box);
  await until(() => box.sessions().length === 2, 30, "both games");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe(0);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions }).toEqual({ processes: 0, sessions: 0 });
}, 60_000);

const poolPair = 94;
const pool = (box: ReturnType<typeof sandbox>, extra: Record<string, string>) => Bun.spawn([process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "pool", "--pair", String(poolPair), "--capacity", capacity, "--desktop", "/bin/true", "--wait", "0"], {
  env: { ...box.env, ...extra }, stdout: "ignore", stderr: "ignore",
});

test("[repro #62] lan pool: SIGTERM while a pair is starting stops its session", async () => {
  const box = sandbox();
  const runner = pool(box, { WISP_TEST_READY_MS: "60000" });
  // The session and both stand-in clients run; the pair isn't ready yet.
  await until(() => box.sessions().length === 1 && box.marked().length >= 5, 30, "the pair session");
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions }).toEqual({ processes: 0, sessions: 0 });
}, 60_000);

test("[repro #62] lan pool: a step failing after a pair started stops its session", async () => {
  const box = sandbox();
  const runner = pool(box, { WISP_TEST_BAD_AGENT: "1" });
  const result = await leftovers(runner, box);
  expect(result.code).toBe(1);
  expect({ processes: result.processes, sessions: result.sessions }).toEqual({ processes: 0, sessions: 0 });
}, 60_000);

test("[repro #62] watch: a pair agent that doesn't answer is a timeout, not a client that isn't playing", async () => {
  const box = sandbox();
  const previous = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = box.env.XDG_STATE_HOME;
  process.env["XDG_DATA_HOME"] = box.env.XDG_DATA_HOME;
  cleanups.push(() => {
    if (previous === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previous;
    delete process.env["XDG_DATA_HOME"];
  });
  const pair = 95;
  mkdirSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${pair}`), { recursive: true });
  const silent = Bun.serve({ unix: agentSocket(pair), fetch: () => new Promise<Response>(() => {}) });
  cleanups.push(() => silent.stop(true));
  writeFileSync(poolFile(), JSON.stringify({ profile: "parity", pairs: [{ id: pair, clients: "", agentSocket: agentSocket(pair), runs: {}, appIds: { a: "steam_app_1", b: "steam_app_2" } }] }));
  const [client] = pairClients(pair, {});
  const exit = await Effect.runPromise(Effect.gen(function*() {
    const looking = yield* Effect.forkChild(Effect.exit(lanObservation({ name: client!.name, documents: client!.documents })));
    for (let tries = 0; tries < 2; tries++) {
      yield* TestClock.withLive(Effect.sleep("50 millis"));
      yield* TestClock.adjust("3 seconds");
    }
    return yield* Fiber.join(looking);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain("didn't answer within 3 s");
});

test("[repro #62] join: a client whose threads don't stop within a second is let go again", async () => {
  const sleeper = Bun.spawn(["sleep", "600"]);
  cleanups.push(() => sleeper.kill("SIGKILL"));
  const state = () => readFileSync(`/proc/${sleeper.pid}/stat`, "latin1").split(") ")[1]?.[0];
  let used = false;
  const exit = await Effect.runPromiseExit(whileStopped(sleeper.pid, Effect.sync(() => { used = true; }), () => false));
  expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain("didn't stop within a second");
  expect(used).toBe(false);
  expect(state()).not.toBe("T");
  // A client that does stop is patched while stopped and let go after.
  const stopped = await Effect.runPromise(whileStopped(sleeper.pid, Effect.sync(state)));
  expect(stopped).toBe("T");
  expect(state()).not.toBe("T");
});
