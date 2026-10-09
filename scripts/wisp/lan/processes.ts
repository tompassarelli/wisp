


import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";


export function prefixPath(prefix: string, windowsPath: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (match === null) return windowsPath;
  return join(prefix, `drive_${(match[1] ?? "c").toLowerCase()}`, ...(match[2] ?? "").split("\\"));
}

export interface GameProcess {
  readonly pid: number;

  readonly exe: string;
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
