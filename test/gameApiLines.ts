import { addFileLine, clearFileLines, endFile, startFile } from "wisp/game/files";

/** A map's `writeLines` on the game API: the same Preload file, written on either backend. */
export function writeLines(this: void, path: string, lines: readonly string[]): void {
  clearFileLines();
  startFile();
  for (const line of lines) addFileLine(line);
  endFile(path);
}
