import { dlopen } from "bun:ffi";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProcessInfo } from "../../warcraft/battleNet";
import type { CpuPressure, GameProcess, LauncherProcess, ServiceOwner } from "../services";

function prefixPath(prefix: string, windowsPath: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (match === null) return windowsPath;
  return join(prefix, `drive_${(match[1] ?? "c").toLowerCase()}`, ...(match[2] ?? "").split("\\"));
}

const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const wineRuntime = (name: string, args: readonly string[]) => name === "wineserver" || /\/wineserver$/.test(args[0] ?? "");

const wineLike = (name: string, args: readonly string[]) => name === "wineserver" || args.some((arg) => /\.exe\b/i.test(arg));

/** Linux's USER_HZ: /proc reports CPU times in these ticks. */
const TICKS_PER_SECOND = 100;

const statFields = (stat: string | undefined) => stat?.slice(stat.lastIndexOf(")") + 2).split(" ");

const startedAt = (stat: string | undefined, bootMs: number) => {
  const ticks = Number(statFields(stat)?.[19]);
  return Number.isFinite(ticks) && Number.isFinite(bootMs) ? bootMs + (ticks * 1000) / TICKS_PER_SECOND : undefined;
};

export function listProcesses(): ProcessInfo[] {
  const found: ProcessInfo[] = [];
  const bootMs = Number(/^btime (\d+)$/m.exec(readText("/proc/stat") ?? "")?.[1]) * 1000;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const base = `/proc/${entry}`;
    const cmdline = readText(`${base}/cmdline`);
    const name = readText(`${base}/comm`)?.trim();
    if (cmdline === undefined || name === undefined) continue;
    const args = cmdline.split("\0");
    if (args.at(-1) === "") args.pop();
    const process: { -readonly [K in keyof ProcessInfo]: ProcessInfo[K] } = { pid: Number(entry), name, args };
    if (wineRuntime(name, args)) process.runtime = true;
    if (wineLike(name, args)) {
      for (const variable of (readText(`${base}/environ`) ?? "").split("\0")) {
        if (variable.startsWith("WINEPREFIX=")) process.prefix = variable.slice("WINEPREFIX=".length).replace(/\/+$/, "");
        if (variable.startsWith("DISPLAY=")) process.display = variable.slice("DISPLAY=".length);
      }
      const stat = readText(`${base}/stat`);
      const started = startedAt(stat, bootMs);
      if (started !== undefined) process.started = started;
      const fields = statFields(stat);
      const cpu = Number(fields?.[11]) + Number(fields?.[12]);
      if (Number.isFinite(cpu)) process.cpuMs = cpu * 1000 / TICKS_PER_SECOND;
      if (name === "wineserver") {
        try {
          process.cwd = readlinkSync(`${base}/cwd`);
        } catch {

        }
      }
    }
    found.push(process);
  }
  return found;
}

const GAME = /^([A-Za-z]:\\[^\0]*\\Warcraft III\.exe)\0/;

export function findGameProcesses(prefix: string): GameProcess[] {
  const wanted = prefix.replace(/\/+$/, "");
  const uid = process.getuid?.();
  const found: GameProcess[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (uid !== undefined && statSync(`/proc/${entry}`).uid !== uid) continue;
      const command = GAME.exec(readFileSync(`/proc/${entry}/cmdline`, "latin1"));
      if (command === null) continue;
      const environment = readFileSync(`/proc/${entry}/environ`, "latin1").split("\0");
      const winePrefix = environment.find((variable) => variable.startsWith("WINEPREFIX="))?.slice("WINEPREFIX=".length).replace(/\/+$/, "");
      if (winePrefix !== wanted) continue;
      found.push({ pid: Number(entry), exe: prefixPath(wanted, command[1] ?? "") });
    } catch {

    }
  }
  return found;
}

export function launcherProcess(pid: number): LauncherProcess {
  const base = `/proc/${pid}`;
  const env = Object.fromEntries(readFileSync(`${base}/environ`, "utf8").split("\0").filter((entry) => entry.includes("="))
    .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)] as const)
    .filter(([name]) => name !== "WINESERVERSOCKET" && name !== "WINELOADERNOEXEC"));
  return { cwd: readlinkSync(`${base}/cwd`), env, runtime: resolve(dirname(readlinkSync(`${base}/exe`)), "../../../bin/wine") };
}

export const alive = (pid: number) => existsSync(`/proc/${pid}`);

export const residentKiB = (pid: number) => Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);

export function interfaces(netDev: string): string[] {
  return netDev.split("\n").slice(2).map((line) => line.split(":")[0]?.trim() ?? "").filter((name) => name !== "");
}

export const networkInterfaces = (pid: number) => interfaces(readFileSync(`/proc/${pid}/net/dev`, "latin1"));

const cgroupOf = (pid: number | "self") => /^0::(.*)$/m.exec(readText(`/proc/${pid}/cgroup`) ?? "")?.[1];
const parentOf = (pid: number) => {
  const parent = Number(statFields(readText(`/proc/${pid}/stat`))?.[1]);
  return Number.isInteger(parent) ? parent : undefined;
};
const commandOf = (pid: number) => (readText(`/proc/${pid}/cmdline`) ?? "").split("\0").filter((arg) => arg !== "").join(" ");

export const ownerOf = (pid: number): ServiceOwner | undefined => {
  const home = `/user@${process.getuid?.() ?? 0}.service/`;
  const leafOf = (cgroup: string) => cgroup.slice(cgroup.lastIndexOf("/") + 1);
  const cgroup = cgroupOf(pid);
  if (cgroup === undefined) return undefined;
  if (cgroup.includes(home) && leafOf(cgroup).endsWith(".service")) return { unit: leafOf(cgroup) };
  if (leafOf(cgroup).startsWith("agent-capacity-")) {
    const members = (readText(`/sys/fs/cgroup${cgroup}/cgroup.procs`) ?? "").split("\n").filter((line) => line !== "").map(Number);
    for (const member of members) {
      const parent = parentOf(member);
      const parentCgroup = parent === undefined ? undefined : cgroupOf(parent);
      if (parent === undefined || parentCgroup === undefined || parentCgroup === cgroup || leafOf(parentCgroup) === "init.scope") continue;
      if (parentCgroup.includes(home) && leafOf(parentCgroup).endsWith(".service")) return { unit: leafOf(parentCgroup) };
      return { pid: parent, command: commandOf(parent) };
    }
  }
  return { pid, command: commandOf(pid) };
};

export function parseCpuPressure(text: string): CpuPressure | undefined {
  const some = /^some avg10=([\d.]+) avg60=[\d.]+ avg300=[\d.]+ total=(\d+)$/m.exec(text);
  return some === null ? undefined : { avg10: Number(some[1]), totalUs: Number(some[2]) };
}

export const cpuPressure = () => {
  const text = readText("/proc/pressure/cpu");
  return text === undefined ? undefined : parseCpuPressure(text);
};

export function cpuLimit(): number | undefined {
  const own = cgroupOf("self");
  if (own === undefined) return undefined;
  let limit: number | undefined;
  for (let directory = join("/sys/fs/cgroup", own); directory.startsWith("/sys/fs/cgroup/"); directory = dirname(directory)) {
    const [quota, period] = readText(join(directory, "cpu.max"))?.trim().split(" ") ?? [];
    if (quota !== undefined && quota !== "max") limit = Math.min(limit ?? Infinity, Number(quota) / Number(period));
  }
  return limit;
}

export const insideCapacityLease = () => readText("/proc/self/cgroup")?.includes("agent-capacity") ?? false;

export const threadClock = (): (() => number) => {
  const libc = dlopen("libc.so.6", { clock_gettime: { args: ["i32", "ptr"], returns: "i32" } });
  const time = new BigInt64Array(2);
  const CLOCK_THREAD_CPUTIME_ID = 3;
  return () => {
    libc.symbols.clock_gettime(CLOCK_THREAD_CPUTIME_ID, time);
    return Number(time[0] ?? 0n) * 1000 + Number(time[1] ?? 0n) / 1e6;
  };
};
