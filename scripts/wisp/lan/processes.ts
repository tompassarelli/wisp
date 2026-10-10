import { join } from "node:path";
import { ProcessTable } from "../../platform/services";

export function prefixPath(prefix: string, windowsPath: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (match === null) return windowsPath;
  return join(prefix, `drive_${(match[1] ?? "c").toLowerCase()}`, ...(match[2] ?? "").split("\\"));
}

export type { GameProcess } from "../../platform/services";

export const findGameProcesses = (prefix: string) => ProcessTable.use((table) => table.games(prefix));
