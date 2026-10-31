import { CHUNKS_PER_FILE } from "./gameFiles";

/** FileIO chunks are spliced into JASS string literals, so these characters cannot be stored. */
const UNSTORABLE = ["\\", "\"", "\n", "\r"] as const;

/** The Preload lines that make Warcraft's loader store `chunks` in the FileIO ability's tooltip levels, or undefined when they cannot be stored. */
export function fileChunkLines(chunks: readonly string[]): string[] | undefined {
  if (chunks.length >= CHUNKS_PER_FILE || chunks.some(chunk => UNSTORABLE.some(character => chunk.includes(character)))) return undefined;
  const lines = chunks.map((chunk, level) => `" )\ncall BlzSetAbilityTooltip('$wsl', "${chunk}", ${level})\n//`);
  return [...lines, "\" )\nendfunction\nfunction a takes nothing returns nothing\n //"];
}
