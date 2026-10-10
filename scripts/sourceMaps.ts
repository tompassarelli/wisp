import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";

const POSITION = /\b(?:map|hot)-(\d+-\d+):(\d+)\b/g;

const consumers = new Map<string, SourceMapConsumer>();

export function keepSourceMap(bundlePath: string, key: string, mapDirectory: string): void {
  mkdirSync(mapDirectory, { recursive: true });
  const path = join(mapDirectory, `${key}.lua.map`);
  copyFileSync(`${bundlePath}.map`, path);
  consumers.delete(path);
}

export function keepModuleSourceMap(key: string, sourceMap: string, mapDirectory: string): void {
  mkdirSync(mapDirectory, { recursive: true });
  const path = join(mapDirectory, `${key}.lua.map`);
  writeFileSync(path, sourceMap);
  consumers.delete(path);
}

async function consumer(key: string, mapDirectory: string): Promise<SourceMapConsumer | undefined> {
  const path = join(mapDirectory, `${key}.lua.map`);
  if (!consumers.has(path) && existsSync(path)) consumers.set(path, await new SourceMapConsumer(await Bun.file(path).json()));
  return consumers.get(path);
}

async function locate(key: string, line: number, mapDirectory: string): Promise<string | undefined> {
  const map = await consumer(key, mapDirectory);
  const position = map?.originalPositionFor({ line, column: 0, bias: SourceMapConsumer.LEAST_UPPER_BOUND });
  if (position?.source == null || position.line == null) return undefined;
  // TypeScriptToLua writes bundle sources relative to each module's own output folder.
  const sourceStart = position.source.indexOf("src/");
  return `${sourceStart < 0 ? position.source : position.source.slice(sourceStart)}:${position.line}`;
}

export async function toTypeScript(text: string, mapDirectory: string): Promise<string> {
  const replacements = await Promise.all(
    [...text.matchAll(POSITION)].map(async ([match, key, line]) => {
      const location = await locate(key!, Number(line), mapDirectory);
      return [match, location ?? match] as const;
    }),
  );
  return replacements.reduce((result, [match, replacement]) => result.replace(match, replacement), text);
}
