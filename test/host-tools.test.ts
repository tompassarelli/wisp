



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
const pool = (box: ReturnType<typeof sandbox>, extra: Record<string, string>) => {
  const plugin = join(box.env.HOME, ".local/share/wisp-private/lan");
  mkdirSync(plugin, { recursive: true });

  writeFileSync(join(plugin, "index.ts"), "export {};\n");
  return Bun.spawn([process.execPath, join(root, "examples/sample/scripts/sample.ts"), "lan", "pool", "--pair", String(poolPair), "--capacity", capacity, "--desktop", "/bin/true", "--wait", "0"], {
    env: { ...box.env, ...extra }, stdout: "ignore", stderr: "ignore",
  });
};

test("[boundary] lan pool: SIGTERM removes desktop markers after its native scope exits", async () => {
  const box = sandbox();
  const runner = pool(box, {});
  await until(() => existsSync(join(box.env.XDG_STATE_HOME, "wisp/lan", `pair-${poolPair}`, "clients.json")), 30, "the ready pool pair");
  expect(box.activeDesktops()).toEqual(["a", "b"]);
  runner.kill("SIGTERM");
  const result = await leftovers(runner, box);
  expect(result.code).not.toBe("still running");
  expect({ processes: result.processes, sessions: result.sessions, activeDesktops: box.activeDesktops() }).toEqual({ processes: 0, sessions: 0, activeDesktops: [] });
}, 60_000);
