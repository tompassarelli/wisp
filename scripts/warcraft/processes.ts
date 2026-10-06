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

export function listProcesses(): ProcessInfo[] {
  const found: ProcessInfo[] = [];
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
