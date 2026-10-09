import { runtimeConfiguration } from "../runtime/config";
import { modelFailureFile, modelFailureRequestFile, modelFailureTokenFile } from "../runtime/gameFiles";
import { readChunk, writeLine } from "./fileio";

interface ModelFailures {
  token: string;
  next: number;
  ticks: number;
  paths: Record<string, boolean | undefined>;
}

function state(): ModelFailures | undefined {
  const globals = globalThis as Record<`${string}ModelFailures`, ModelFailures | undefined>;
  return globals[`${runtimeConfiguration().globalPrefix}ModelFailures`];
}

/** Requests a new local report stream before any map models are created. */
export function startModelFailures(): void {
  const config = runtimeConfiguration();
  const globals = globalThis as Record<`${string}ModelFailures`, ModelFailures | undefined>;
  const slot = GetPlayerId(GetLocalPlayer());
  let ordinal = 1;
  while (readChunk(modelFailureTokenFile(slot, ordinal, config.filePrefix)) !== undefined) ordinal++;
  const token = `${slot}-${ordinal}`;
  globals[`${config.globalPrefix}ModelFailures`] = { token, next: 1, ticks: 0, paths: {} };
  writeLine(modelFailureRequestFile(slot, config.filePrefix), token);
}

/** Local file results only change existing visual handles, never synchronized state. */
export function pollModelFailures(): void {
  const failures = state();
  if (failures === undefined) return;
  failures.ticks++;
  if (failures.ticks < 32) return;
  failures.ticks = 0;
  let path = readChunk(modelFailureFile(failures.token, failures.next, runtimeConfiguration().filePrefix));
  while (path !== undefined) {
    failures.paths[path.split("\\").join("/").toLowerCase()] = true;
    failures.next++;
    path = readChunk(modelFailureFile(failures.token, failures.next, runtimeConfiguration().filePrefix));
  }
}

export function modelFailed(path: string): boolean {
  return state()?.paths[path.split("\\").join("/").toLowerCase()] === true;
}
