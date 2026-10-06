// Saving a repro from the map (wisp:docs/repro.md): a Preload file in this
// client's CustomMapData, which `wisp repro` reads. Local to this client.
import { type ReproHeader, reproLines } from "../runtime/repro";
import { writeLines } from "./fileio";

/** Writes a repro; name it with reproFile, so no two share a name in a session. Keep each line within REPRO_LINE_WIDTH. */
export function writeRepro(filename: string, header: ReproHeader, lines: readonly string[]): void {
  writeLines(filename, reproLines(header, lines));
}
