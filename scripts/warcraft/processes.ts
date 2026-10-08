// The host's process table, read from /proc: each process's name and
// arguments, and for Wine's processes their prefix, display and (for a
// wineserver) working directory.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import type { ProcessInfo } from "./battleNet";

const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** Only Wine's processes need their environment and the wineserver its directory; reading every process's would cost each poll. */
const wineLike = (name: string, args: readonly string[]) => name === "wineserver" || args.some((arg) => /\.exe\b/i.test(arg));

/** The kernel reports start times in USER_HZ ticks since boot, fixed at 100 on Linux. */
const TICKS_PER_SECOND = 100;

/** A process's start in epoch milliseconds: /proc/PID/stat's 22nd field after the boot time in /proc/stat. */
const startedAt = (stat: string | undefined, bootMs: number) => {
  // The command name (field 2) can hold spaces and parentheses; the fields after its last ")" start at field 3.
  const ticks = Number(stat?.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
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
    // The process exited while the table was read.
    if (cmdline === undefined || name === undefined) continue;
    const args = cmdline.split("\0");
    if (args.at(-1) === "") args.pop();
    const process: { -readonly [K in keyof ProcessInfo]: ProcessInfo[K] } = { pid: Number(entry), name, args };
    if (wineLike(name, args)) {
      for (const variable of (readText(`${base}/environ`) ?? "").split("\0")) {
        if (variable.startsWith("WINEPREFIX=")) process.prefix = variable.slice("WINEPREFIX=".length).replace(/\/+$/, "");
        if (variable.startsWith("DISPLAY=")) process.display = variable.slice("DISPLAY=".length);
      }
      const started = startedAt(readText(`${base}/stat`), bootMs);
      if (started !== undefined) process.started = started;
      if (name === "wineserver") {
        try {
          process.cwd = readlinkSync(`${base}/cwd`);
        } catch {
          // Another user's or an exited process.
        }
      }
    }
    found.push(process);
  }
  return found;
}
