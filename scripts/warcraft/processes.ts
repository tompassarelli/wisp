


import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import type { ProcessInfo } from "./battleNet";

const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};


const wineLike = (name: string, args: readonly string[]) => name === "wineserver" || args.some((arg) => /\.exe\b/i.test(arg));


const TICKS_PER_SECOND = 100;


const startedAt = (stat: string | undefined, bootMs: number) => {

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

    if (cmdline === undefined || name === undefined) continue;
    const args = cmdline.split("\0");
    if (args.at(-1) === "") args.pop();
    const process: { -readonly [K in keyof ProcessInfo]: ProcessInfo[K] } = { pid: Number(entry), name, args };
    if (wineLike(name, args)) {
      for (const variable of (readText(`${base}/environ`) ?? "").split("\0")) {
        if (variable.startsWith("WINEPREFIX=")) process.prefix = variable.slice("WINEPREFIX=".length).replace(/\/+$/, "");
        if (variable.startsWith("DISPLAY=")) process.display = variable.slice("DISPLAY=".length);
      }
      const stat = readText(`${base}/stat`);
      const started = startedAt(stat, bootMs);
      if (started !== undefined) process.started = started;
      const fields = stat?.slice(stat.lastIndexOf(")") + 2).split(" ");
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
