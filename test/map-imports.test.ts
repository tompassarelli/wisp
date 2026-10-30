import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { ensurePackager, mapPack } from "../host/compile/mapBuild";
import { extractMapImports } from "../host/play/mapImports";

const build = join(import.meta.dir, "../build");
mkdirSync(build, { recursive: true });
const work = mkdtempSync(join(build, "map-imports-"));

test("[spec docs/play.md] extractMapImports unpacks a map's files once into a cache keyed by the map", async () => {
  const packager = join(build, "tools/map-pack");
  await Effect.runPromise(ensurePackager(packager));
  const source = join(work, "model.mdx");
  writeFileSync(source, "model bytes");
  const map = join(work, "player.w3x");
  await Effect.runPromise(mapPack(packager).create(map, [{ entry: "war3mapImported\\Model.mdx", source }], join(work, "list")));
  const cache = join(work, "cache");
  const first = await Effect.runPromise(extractMapImports(map, packager, cache));
  expect(first.map(({ entry }) => entry)).toEqual(["war3mapImported\\Model.mdx"]);
  expect(await Bun.file(first[0]?.source ?? "").text()).toBe("model bytes");
  const again = await Effect.runPromise(extractMapImports(map, "/nonexistent/map-pack", cache));
  expect(again).toEqual(first);
  expect(existsSync(join(cache, first[0]?.source.split("/").at(-2) ?? ""))).toBe(true);
});
