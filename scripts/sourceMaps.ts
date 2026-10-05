// Maps Lua positions in in-game error reports back to TypeScript lines. Every
// bundle that can run in a client, the one built into the map and each hot
// reload, keeps its source map here under its payload key, which is also its
// Lua chunk name (`map-KEY` or `hot-KEY`).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";

const POSITION = /\b(?:map|hot)-(\d+-\d+):(\d+)\b/g;

export function keepSourceMap(bundlePath: string, key: string, mapDirectory: string): void {
  mkdirSync(mapDirectory, { recursive: true });
  copyFileSync(`${bundlePath}.map`, join(mapDirectory, `${key}.lua.map`));
}

const consumers = new Map<string, SourceMapConsumer>();

async function consumer(key: string, mapDirectory: string): Promise<SourceMapConsumer | undefined> {
  const path = join(mapDirectory, `${key}.lua.map`);
  if (!consumers.has(path) && existsSync(path)) consumers.set(path, await new SourceMapConsumer(await Bun.file(path).json()));
  return consumers.get(path);
}

/** The TypeScript file and line for a Lua line of a bundle, relative to the consuming project. */
async function locate(key: string, line: number, mapDirectory: string): Promise<string | undefined> {
  const map = await consumer(key, mapDirectory);
  const position = map?.originalPositionFor({ line, column: 0, bias: SourceMapConsumer.LEAST_UPPER_BOUND });
  if (position?.source == null || position.line == null) return undefined;
  // TypeScriptToLua writes bundle sources relative to each module's own output folder.
  const sourceStart = position.source.indexOf("src/");
  return `${sourceStart < 0 ? position.source : position.source.slice(sourceStart)}:${position.line}`;
}

/** Replaces every bundle position in a report with its TypeScript file and line. */
export async function toTypeScript(text: string, mapDirectory: string): Promise<string> {
  const replacements = await Promise.all(
    [...text.matchAll(POSITION)].map(async ([match, key, line]) => {
      const location = await locate(key!, Number(line), mapDirectory);
      return [match, location ?? match] as const;
    }),
  );
  return replacements.reduce((result, [match, replacement]) => result.replace(match, replacement), text);
}
