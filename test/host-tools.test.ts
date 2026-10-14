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
  for (const tool of ["pw-dump", "pw-cli"]) chmodSync(join(bin, tool), 0o755);
  const env = {
    ...process.env,
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
const pool = (box: ReturnType<typeof sandbox>, extra: Record<string, string>, pair = poolPair) => {
  const plugin = join(box.env.HOME, ".local/share/wisp-private/lan");
  mkdirSync(plugin, { recursive: true });

  writeFileSync(join(plugin, "index.ts"), "export {};\n");
  return Bun.spawn([process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "pool", "--pair", String(pair), "--capacity", capacity, "--desktop", join(fixtures, "desktop.sh"), "--wait", "0"], {
    env: { ...box.env, ...extra }, stdout: "pipe", stderr: "pipe",
  });
};

test("[boundary] lan pool: playtest admits one pair, refuses held and racing pairs before launch, off and remote admission stay available, and SIGTERM cleans owned processes", async () => {
  const box = sandbox();
  const playtest = join(box.env.HOME, ".local/state/playtest/state.json");
  mkdirSync(join(playtest, ".."), { recursive: true });
  writeFileSync(playtest, JSON.stringify({ on: true, auto: true, since: 1791979200 }));
  const runner = pool(box, {});
  await until(() => existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair}`, "clients.json")), 30, "the ready pool pair");
  expect(box.activeDesktops()).toEqual(["a", "b"]);
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
  expect(existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair + 1}`, "pool.pid"))).toBe(false);
  expect(box.activeDesktops()).toEqual(["a", "b"]);
  for (const on of [false, undefined]) {
    if (on === undefined) rmSync(playtest);
    else writeFileSync(playtest, JSON.stringify({ on }));
    const additional = pool(box, { WISP_TEST_DESKTOPS: join(box.env.WISP_TEST_DESKTOPS, "additional") }, poolPair + 1);
    const clients = join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair + 1}`, "clients.json");
    await until(() => existsSync(clients), 30, "the additional pool pair");
    expect(box.sessions()).toHaveLength(2);
    additional.kill("SIGTERM");
    await additional.exited;
    rmSync(clients);
    expect(box.sessions()).toHaveLength(1);
    expect(box.activeDesktops()).toEqual(["a", "b"]);
  }
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions, activeDesktops: box.activeDesktops() }).toEqual({ processes: 0, sessions: 0, activeDesktops: [] });
  writeFileSync(playtest, JSON.stringify({ on: true, auto: false }));
  const racing = [poolPair + 1, poolPair + 2].map((pair) => {
    const child = pool(box, { WISP_TEST_DESKTOPS: join(box.env.WISP_TEST_DESKTOPS, String(pair)) }, pair);
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
