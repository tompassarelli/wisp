// FileIO reads are local; synchronized state may use their results only after a sync message.



import { CHUNKS_PER_FILE, FILE_IO_ABILITY } from "../runtime/gameFiles";
const EMPTY = " ";

export function readChunks(filename: string): string[] {
  for (let level = 0; level < CHUNKS_PER_FILE; level++) BlzSetAbilityTooltip(FILE_IO_ABILITY, EMPTY, level);
  Preloader(filename);
  const chunks: string[] = [];
  for (let level = 0; level < CHUNKS_PER_FILE; level++) {
    const chunk = BlzGetAbilityTooltip(FILE_IO_ABILITY, level);
    if (chunk === EMPTY) break;
    chunks.push(chunk);
    BlzSetAbilityTooltip(FILE_IO_ABILITY, EMPTY, level);
  }
  return chunks;
}


export function readChunk(filename: string): string | undefined {
  BlzSetAbilityTooltip(FILE_IO_ABILITY, EMPTY, 0);
  Preloader(filename);
  const chunk = BlzGetAbilityTooltip(FILE_IO_ABILITY, 0);
  BlzSetAbilityTooltip(FILE_IO_ABILITY, EMPTY, 0);
  return chunk === EMPTY || chunk === "" ? undefined : chunk;
}


export function writeLine(filename: string, line: string): void {
  writeLines(filename, [line]);
}


export function writeLines(filename: string, lines: readonly string[]): void {
  PreloadGenClear();
  PreloadGenStart();
  for (const line of lines) Preload(line);
  PreloadGenEnd(filename);
}

/** FileIO chunks are spliced into JASS string literals, so these characters cannot be stored. */
const UNSTORABLE = ["\\", "\"", "\n", "\r"] as const;






export function writeChunks(filename: string, chunks: readonly string[]): boolean {
  if (chunks.length >= CHUNKS_PER_FILE || chunks.some(chunk => UNSTORABLE.some(character => chunk.includes(character)))) return false;
  const lines = chunks.map((chunk, level) => `" )\ncall BlzSetAbilityTooltip('$wsl', "${chunk}", ${level})\n//`);
  writeLines(filename, [...lines, "\" )\nendfunction\nfunction a takes nothing returns nothing\n //"]);
  return true;
}
