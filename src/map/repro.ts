import { type ReproHeader, reproLines } from "../runtime/repro";
import { writeLines } from "wisp/src/map/fileio";

export function writeRepro(filename: string, header: ReproHeader, lines: readonly string[]): void {
  writeLines(filename, reproLines(header, lines));
}
