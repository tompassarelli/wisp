// Bun's FileIO: the same exports as src/map/fileio.ts, over the bound world's files instead of Warcraft's tooltip buffer.

import { fileChunkLines } from "../../runtime/fileChunks";
import { CHUNKS_PER_FILE } from "../../runtime/gameFiles";
import { addFileLine, clearFileLines, endFile, startFile } from "./files";
import { boundWorld } from "./world";

const EMPTY = " ";

/** The FileIO chunks of the file at `filename`, as the Warcraft reader returns them: up to the first empty slot, or the slot count. */
export function readChunks(filename: string): string[] {
  const stored = boundWorld().files.read(filename) ?? [];
  const chunks: string[] = [];
  for (let level = 0; level < CHUNKS_PER_FILE; level++) {
    const chunk = level < stored.length ? stored[level] ?? "" : EMPTY;
    if (chunk === EMPTY) break;
    chunks.push(chunk);
  }
  return chunks;
}

export function readChunk(filename: string): string | undefined {
  const chunk = boundWorld().files.read(filename)?.[0] ?? EMPTY;
  return chunk === EMPTY || chunk === "" ? undefined : chunk;
}

export function writeLine(filename: string, line: string): void {
  writeLines(filename, [line]);
}

export function writeLines(filename: string, lines: readonly string[]): void {
  clearFileLines();
  startFile();
  for (const line of lines) addFileLine(line);
  endFile(filename);
}

export function writeChunks(filename: string, chunks: readonly string[]): boolean {
  const lines = fileChunkLines(chunks);
  if (lines === undefined) return false;
  writeLines(filename, lines);
  return true;
}
