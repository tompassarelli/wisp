import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "fixtures/host-tools");
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const sandbox = () => {
  const folder = mkdtempSync(join(tmpdir(), "wisp-host-tools-"));
  const mark = crypto.randomUUID();
  const bin = join(folder, "bin");
  mkdirSync(bin);

  writeFileSync(join(bin, "pw-dump"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(bin, "pw-cli"), "#!/bin/sh\nexit 1\n");
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh\nexec "$WISP_TEST_BUN" "${join(fixtures, "systemctl.ts")}" "$@"\n`);
  for (const tool of ["pw-dump", "pw-cli", "systemctl"]) chmodSync(join(bin, tool), 0o755);
  const { NORTH_FLEET_SESSION: _session, ...inherited } = process.env;
  const env = {
    ...inherited,
    HOME: folder,
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    XDG_STATE_HOME: join(folder, "state"),
    XDG_DATA_HOME: join(folder, "data"),
    WISP_XDOTOOL: "/bin/true",
    WISP_TEST_SESSIONS: join(folder, "sessions"),
    WISP_TEST_DESKTOPS: join(folder, "desktops"),
    WISP_TEST_MARK: mark,
    WISP_TEST_BUN: process.execPath,
    PLAYTEST_STATE: join(folder, ".local/state/playtest/state.json"),
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
    const holders = existsSync(env.WISP_TEST_DESKTOPS) ? readdirSync(env.WISP_TEST_DESKTOPS, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === "holders").flatMap((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8").split("\n").filter(Boolean).map(Number)) : [];
    for (const pid of [...marked(), ...holders]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(folder, { recursive: true, force: true });
  });
  const activeDesktops = () => ["a", "b"].filter((side) => existsSync(join(env.WISP_TEST_DESKTOPS, `private-desktop.${side}`, "active")));
  return { env, marked, sessions, activeDesktops };
};

const until = async (check: () => boolean, seconds: number, what: string) => {
  for (const deadline = Date.now() + seconds * 1000; !check();) {
    if (Date.now() > deadline) throw new Error(`${what} not within ${seconds} s`);
    await Bun.sleep(100);
  }
};

const leftovers = async (runner: Bun.Subprocess, box: ReturnType<typeof sandbox>) => {
  const code = await Promise.race([runner.exited, Bun.sleep(30_000).then(() => "still running")]);
  await Bun.sleep(500);
  return { code, processes: box.marked().length, sessions: box.sessions().length };
};

const capacity = join(fixtures, "capacity.ts");

const poolPair = 94;
const pool = (box: ReturnType<typeof sandbox>, extra: Record<string, string>, pair = poolPair, flags: readonly string[] = [], within: readonly string[] = []) => {
  const plugin = join(box.env.HOME, ".local/share/wisp-private/lan");
  mkdirSync(plugin, { recursive: true });

  writeFileSync(join(plugin, "index.ts"), "export {};\n");
  return Bun.spawn([...within, process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "pool", "--pair", String(pair), "--capacity", capacity, "--desktop", join(fixtures, "desktop.sh"), "--wait", "0", ...flags], {
    env: { ...box.env, ...extra }, stdout: "pipe", stderr: "pipe",
  });
};

const pairState = (box: ReturnType<typeof sandbox>, pair: number) => join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${pair}`);

const claimOf = (box: ReturnType<typeof sandbox>, pair: number) => {
  try {
    return JSON.parse(readFileSync(join(pairState(box, pair), "claim.json"), "utf8")) as { pid: number; session: string; agent?: { pid: number } };
  } catch {
    return undefined;
  }
};

const poolIds = (box: ReturnType<typeof sandbox>) => {
  try {
    return (JSON.parse(readFileSync(join(box.env.XDG_STATE_HOME, "wisp/lan/pool.json"), "utf8")) as { pairs: { id: number }[] }).pairs.map(({ id }) => id);
  } catch {
    return [];
  }
};

test("[boundary] lan pool: playtest admits one pair, refuses held and racing pairs before launch, off and remote admission stay available, pool.json lists every running pair, and lan stop and SIGTERM clean owned processes", async () => {
  const box = sandbox();
  const playtest = join(box.env.HOME, ".local/state/playtest/state.json");
  mkdirSync(join(playtest, ".."), { recursive: true });
  writeFileSync(playtest, JSON.stringify({ on: true, auto: true, since: 1791979200 }));
  const pairDirectory = join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair}`);
  mkdirSync(pairDirectory, { recursive: true });
  const holder = join(pairDirectory, "claim.json");
  const foreign = `${JSON.stringify({ pair: poolPair, owner: "", session: "", pid: 2147483647, start: 1 })}\n`;
  writeFileSync(holder, foreign);
  const custody = Bun.spawn(["flock", "--exclusive", "--no-fork", join(pairDirectory, "pool.lock"), "sh", "-c", "echo held; exec cat >/dev/null"], { env: box.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  try {
    expect((await custody.stdout.getReader().read()).done).toBe(false);
    const contenders = [pool(box, {}), pool(box, {})];
    for (const child of contenders) {
      const code = await Promise.race([child.exited, Bun.sleep(10_000).then(() => "still running")]);
      if (code === "still running") {
        child.kill("SIGTERM");
        await child.exited;
      }
      expect(code).toBe(1);
      expect(await new Response(child.stdout).text()).toContain("held by wisp lan pool");
    }
    expect(readFileSync(holder, "utf8")).toBe(foreign);
    expect(box.sessions()).toHaveLength(0);
    expect(box.activeDesktops()).toEqual([]);
  } finally {
    custody.stdin.end();
    expect(await custody.exited).toBe(0);
  }
  const runner = pool(box, {});
  await until(() => existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair}`, "clients.json")), 30, "the ready pool pair");
  expect(box.activeDesktops()).toEqual(["a", "b"]);
  expect(claimOf(box, poolPair)?.pid).toBe(runner.pid);
  const locked = Bun.spawn(["flock", "--exclusive", "--nonblock", join(pairDirectory, "pool.lock"), "true"], { env: box.env, stdout: "pipe", stderr: "pipe" });
  expect(await locked.exited).toBe(1);
  const second = pool(box, {});
  const secondCode = await Promise.race([second.exited, Bun.sleep(20_000).then(() => "still running")]);
  if (secondCode === "still running") second.kill("SIGKILL");
  const secondOut = await new Response(second.stdout).text();
  expect({ code: secondCode, held: secondOut.includes(`held by wisp lan pool ${runner.pid}`) }).toEqual({ code: 1, held: true });
  const refused = pool(box, {}, poolPair + 1);
  const refusedCode = await Promise.race([refused.exited, Bun.sleep(10_000).then(() => "still running")]);
  if (refusedCode === "still running") {
    refused.kill("SIGTERM");
    await refused.exited;
  }
  expect(refusedCode).toBe(1);
  const refusal = await new Response(refused.stdout).text();
  expect(refusal).toContain("playtest is on");
  expect(refusal).toContain("Nexus or the Warcraft VM");
  expect(box.sessions()).toHaveLength(1);
  expect(existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair + 1}`, "clients.json"))).toBe(false);
  expect(existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair + 1}`, "claim.json"))).toBe(false);
  expect(box.activeDesktops()).toEqual(["a", "b"]);
  for (const on of [false, undefined]) {
    if (on === undefined) rmSync(playtest);
    else writeFileSync(playtest, JSON.stringify({ on }));
    const additional = pool(box, { WISP_TEST_DESKTOPS: join(box.env.WISP_TEST_DESKTOPS, "additional"), WISP_TEST_HOLDER: "quiet" }, poolPair + 1);
    const clients = join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair + 1}`, "clients.json");
    await until(() => existsSync(clients) && poolIds(box).length === 2, 30, "the additional pool pair");
    expect(poolIds(box)).toEqual([poolPair, poolPair + 1]);
    expect(box.sessions()).toHaveLength(2);
    const stop = Bun.spawn([process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "stop", "--pair", String(poolPair + 1)], { env: box.env, stdout: "pipe", stderr: "pipe" });
    expect({ code: await stop.exited, out: (await new Response(stop.stdout).text()).trim() }).toEqual({ code: 0, out: `pair ${poolPair + 1}: pool ${additional.pid} stopped; none of its games run` });
    await additional.exited;
    rmSync(clients);
    expect(box.sessions()).toHaveLength(1);
    expect(poolIds(box)).toEqual([poolPair]);
    expect(box.activeDesktops()).toEqual(["a", "b"]);
  }
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions, activeDesktops: box.activeDesktops() }).toEqual({ processes: 0, sessions: 0, activeDesktops: [] });
  expect(existsSync(holder)).toBe(false);
  const released = Bun.spawn(["flock", "--exclusive", "--nonblock", join(pairDirectory, "pool.lock"), "true"], { env: box.env, stdout: "pipe", stderr: "pipe" });
  expect(await released.exited).toBe(0);
  writeFileSync(playtest, JSON.stringify({ on: true, auto: false }));
  const racing = [poolPair + 1, poolPair + 2].map((pair) => {
    const child = pool(box, { WISP_TEST_DESKTOPS: join(box.env.WISP_TEST_DESKTOPS, String(pair)), WISP_TEST_HOLDER: "quiet" }, pair);
    let exited = false;
    void child.exited.then(() => { exited = true; });
    return { pair, child, ended: () => exited };
  });
  await until(() => racing.every(({ pair, ended }) => ended() || existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${pair}`, "clients.json"))), 30, "the racing pool decisions");
  const admitted = racing.filter(({ ended }) => !ended());
  expect(admitted.length).toBeLessThanOrEqual(1);
  expect(box.sessions().length).toBe(admitted.length);
  for (const { child, ended } of racing) {
    if (ended()) {
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stdout).text()).toContain("playtest is on");
    } else {
      child.kill("SIGTERM");
      await child.exited;
    }
  }
  expect({ processes: box.marked().length, sessions: box.sessions().length }).toEqual({ processes: 0, sessions: 0 });
}, 120_000);

test("[boundary] lan pool: SIGTERM while a pair is still starting stops its agent before its desktops, so none of its games outlive the pool", async () => {
  const box = sandbox();
  const pair = poolPair + 3;
  const runner = pool(box, { WISP_TEST_AGENT_READY_MS: "20000" }, pair);
  await until(() => existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${pair}`, "agent.pid")) && box.sessions().length === 1, 30, "the starting pair's agent");
  expect(existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${pair}`, "agent.json"))).toBe(false);
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions }).toEqual({ processes: 0, sessions: 0 });
}, 60_000);

test("[boundary] lan pool: an agent killed during its pair's start still has its clients' capacity scopes stopped, so none of its games outlive the pool", async () => {
  const box = sandbox();
  const pair = poolPair + 4;
  const directory = join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${pair}`);
  const die = join(box.env.HOME, "agent-die");
  const runner = pool(box, { WISP_TEST_AGENT_READY_MS: "20000", WISP_TEST_AGENT_DIE: die }, pair);
  await until(() => existsSync(join(directory, "agent.pid")) && ["a", "b"].every((side) => existsSync(join(directory, `lan${pair}${side}.err`))) && box.sessions().length === 1, 30, "the starting pair's agent and clients");
  const agent = Number(readFileSync(join(directory, "agent.pid"), "utf8").trim());
  writeFileSync(die, "");
  await until(() => {
    try {
      return readFileSync(`/proc/${agent}/environ`, "latin1") === "";
    } catch {
      return true;
    }
  }, 10, "the killed agent's exit");
  expect(existsSync(join(directory, "agent.json"))).toBe(false);
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions }).toEqual({ processes: 0, sessions: 0 });
}, 60_000);

const tickets = (box: ReturnType<typeof sandbox>, pair: number) => {
  try {
    return readdirSync(join(pairState(box, pair), "queue")).filter((name) => /^\d{12}\.json$/.test(name));
  } catch {
    return [];
  }
};

const lockFree = async (box: ReturnType<typeof sandbox>, pair: number) => (await Bun.spawn(["flock", "--exclusive", "--nonblock", join(pairState(box, pair), "pool.lock"), "true"]).exited) === 0;

const settled = async (check: () => boolean, seconds: number) => {
  for (const deadline = Date.now() + seconds * 1000; !check() && Date.now() < deadline;) await Bun.sleep(100);
  return check();
};

const stopFrom = async (box: ReturnType<typeof sandbox>, session: string, pair: number) => {
  const stop = Bun.spawn([process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "stop", "--pair", String(pair)], { env: { ...box.env, NORTH_FLEET_SESSION: session }, stdout: "pipe", stderr: "pipe" });
  return { code: await stop.exited, out: (await new Response(stop.stdout).text()).trim() };
};

test("[boundary] lan pool --queue: two waiters get a held pair in the order they asked, claim.json names each pool once it holds pool.lock, and lan stop frees the pair from another session", async () => {
  const box = sandbox();
  const pair = poolPair + 5;
  const quiet = { WISP_TEST_HOLDER: "quiet" };
  const first = pool(box, { ...quiet, NORTH_FLEET_SESSION: "holder" }, pair);
  await until(() => claimOf(box, pair)?.pid === first.pid, 30, "the first pool's claim");
  const early = pool(box, { ...quiet, NORTH_FLEET_SESSION: "early" }, pair, ["--queue"]);
  await until(() => tickets(box, pair).length === 1, 15, "the early waiter's ticket");
  const late = pool(box, { ...quiet, NORTH_FLEET_SESSION: "late" }, pair, ["--queue"]);
  await until(() => tickets(box, pair).length === 2, 15, "the late waiter's ticket");
  const barging = pool(box, quiet, pair);
  const bargingCode = await Promise.race([barging.exited, Bun.sleep(15_000).then(() => "still running")]);
  if (bargingCode === "still running") barging.kill("SIGKILL");
  expect({ code: bargingCode, refused: (await new Response(barging.stdout).text()).includes("2 waiting in line for it (first: fleet session early)") }).toEqual({ code: 1, refused: true });

  expect(await stopFrom(box, "late", pair)).toMatchObject({ code: 0, out: expect.stringContaining(`pair ${pair}: pool ${first.pid} stopped;`) });
  expect(await settled(() => claimOf(box, pair)?.pid === early.pid, 15)).toBe(true);
  expect({ session: claimOf(box, pair)?.session, lockFree: await lockFree(box, pair), waiting: tickets(box, pair).length }).toEqual({ session: "early", lockFree: false, waiting: 1 });

  expect(await stopFrom(box, "holder", pair)).toMatchObject({ code: 0, out: expect.stringContaining(`pair ${pair}: pool ${early.pid} stopped;`) });
  expect(await settled(() => claimOf(box, pair)?.pid === late.pid, 15)).toBe(true);
  expect({ session: claimOf(box, pair)?.session, lockFree: await lockFree(box, pair), waiting: tickets(box, pair).length }).toEqual({ session: "late", lockFree: false, waiting: 0 });

  late.kill("SIGTERM");
  const result = await leftovers(late, box);
  expect({ code: result.code === "still running", processes: result.processes, sessions: result.sessions, claim: claimOf(box, pair), lockFree: await lockFree(box, pair) }).toEqual({ code: false, processes: 0, sessions: 0, claim: undefined, lockFree: true });
}, 120_000);

test("[boundary] lan pool: a pool or a queued waiter whose fleet session's process exits stops itself, and its pair's claim, lock and line are freed", async () => {
  const box = sandbox();
  const pair = poolPair + 6;
  const session = (name: string, flags: readonly string[]) => pool(box, { WISP_TEST_HOLDER: "quiet", NORTH_FLEET_SESSION: name }, pair, flags, ["sh", "-c", '"$@" & wait', "sh"]);
  const holder = session("gone-holder", []);
  await until(() => claimOf(box, pair)?.agent?.pid === holder.pid, 30, "the holder's claim naming its session's process");
  const waiter = session("gone-waiter", ["--queue"]);
  await until(() => tickets(box, pair).length === 1, 15, "the waiter's ticket");

  waiter.kill("SIGKILL");
  expect(await settled(() => tickets(box, pair).length === 0, 15)).toBe(true);
  expect(claimOf(box, pair)?.session).toBe("gone-holder");

  holder.kill("SIGKILL");
  expect(await settled(() => claimOf(box, pair) === undefined && box.sessions().length === 0, 30)).toBe(true);
  expect(await lockFree(box, pair)).toBe(true);
  expect(await settled(() => box.marked().length === 0, 15)).toBe(true);
}, 120_000);
