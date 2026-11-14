import { afterEach, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PACKAGER_BUILD_MS, buildPackager, packagerCache } from "./packagerCache";

const root = join(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "fixtures/host-tools");
const cleanups: (() => void)[] = [];
beforeAll(buildPackager, PACKAGER_BUILD_MS);
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
    XDG_CACHE_HOME: packagerCache,
    XDG_DATA_HOME: join(folder, "data"),
    WISP_XDOTOOL: "/bin/true",
    WISP_TEST_SESSIONS: join(folder, "sessions"),
    WISP_TEST_DESKTOPS: join(folder, "desktops"),
    WISP_TEST_MARK: mark,
    WISP_TEST_BUN: process.execPath,
    PLAYTEST_STATE: join(folder, ".local/state/playtest/state.json"),
  };
  for (let pair = poolPair; pair < poolPair + 16; pair++) for (const side of ["a", "b"]) {
    const exe = join(env.XDG_DATA_HOME, "wisp/lan/clients", `lan${pair}${side}`, "pfx/drive_c/Program Files (x86)/Warcraft III/_retail_/x86_64/Warcraft III.exe");
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "");
    writeFileSync(join(exe, "../../../.build.info"), "");
  }
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

const capacity = join(tmpdir(), `wisp-host-tools-north-${process.pid}`);
writeFileSync(capacity, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(fixtures, "capacity.ts"))} "$@"\n`, { mode: 0o755 });

const poolPair = 94;
const pool = (box: ReturnType<typeof sandbox>, extra: Record<string, string>, pair = poolPair, flags: readonly string[] = [], within: readonly string[] = []) => {
  const plugin = join(box.env.HOME, ".local/share/wisp-private/lan");
  mkdirSync(plugin, { recursive: true });

  writeFileSync(join(plugin, "index.ts"), "export {};\n");
  return Bun.spawn([...within, process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "pool", "--pair", String(pair), "--capacity-bin", capacity, "--desktop", join(fixtures, "desktop.sh"), ...flags, "--wait", "0"], {
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

const lockFree = async (box: ReturnType<typeof sandbox>, pair: number) => (await Bun.spawn(["flock", "--exclusive", "--nonblock", join(pairState(box, pair), "pool.lock"), "true"]).exited) === 0;

test("[boundary] lan pool: a pool started inside a private desktop takes the process that launched the desktop as its owner, so it outlives the desktop's wrapper shell (wisp#93)", async () => {
  const box = sandbox();
  const pair = poolPair + 9;
  const desktop = pool(box, { WISP_TEST_HOLDER: "quiet", NORTH_FLEET_SESSION: "desk", PRIVATE_DESKTOP_RUN: "/run/private-desktop.test" }, pair, [], ["sh", "-c", '"$@" & sleep 1', "sh"]);
  await until(() => claimOf(box, pair)?.agent !== undefined, 30, "the pool's claim naming its owner");
  expect(claimOf(box, pair)?.agent?.pid).toBe(process.pid);
  await until(() => !existsSync(`/proc/${desktop.pid}`) || readFileSync(`/proc/${desktop.pid}/stat`, "utf8").includes(") Z "), 15, "the wrapper shell to exit");
  await Bun.sleep(6000);
  expect({ claimed: claimOf(box, pair)?.session, lockFree: await lockFree(box, pair) }).toEqual({ claimed: "desk", lockFree: false });
}, 120_000);
