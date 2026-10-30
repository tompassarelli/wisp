import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { assetArchive, mapPack } from "../host/compile/mapBuild";
import { assetManifest, nearestAssetArchive, type AssetManifest } from "../host/compile/assetArchivePlan";
import { syntheticBaseMap } from "../host/compile/syntheticBaseMap";

const build = join(import.meta.dir, "../build");
mkdirSync(build, { recursive: true });
const work = mkdtempSync(join(build, "asset-archive-"));
const packager = join(work, "map-pack");

const importFile = (name: string, contents: string) => {
  const source = join(work, `import-${name}`);
  writeFileSync(source, contents.repeat(512));
  return { entry: `war3mapImported\\${name}`, source };
};

const extractAll = async (archive: string, entries: readonly { readonly entry: string }[]) => {
  const extracted = entries.map(({ entry }, index) => ({ entry, source: join(work, `out-${index}`) }));
  await Effect.runPromise(mapPack(packager).extractAll(archive, extracted, join(work, "out-list")));
  return extracted.map(({ source }) => readFileSync(source));
};

const cacheOf = (name: string) => {
  const cache = join(work, name);
  process.env.WISP_COMPILE_CACHE = cache;
  return join(cache, "archives");
};

const manifest = (generation: number, container: string, entries: Record<string, string>): AssetManifest => ({ container, generation, entries });

test("[invariant] a build whose imports differ from a cached archive's in N files replaces only those N entries and lists the bytes of a full repack", async () => {
  const container = join(work, "container.w3x");
  await Effect.runPromise(syntheticBaseMap(packager, container));
  const imports = Array.from({ length: 40 }, (_, index) => importFile(`model-${index}.mdx`, `model ${index} `));
  const changed = [...imports.slice(0, 5), importFile("model-5.mdx", "model 5 changed "), ...imports.slice(6), importFile("added.blp", "added ")];

  const archives = cacheOf("incremental");
  await Effect.runPromise(assetArchive(packager, container, imports, work));
  const first = readdirSync(archives).filter((name) => name.endsWith(".json"));
  expect(first).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(archives, first[0]!), "utf8")).generation).toBe(0);

  const incremental = await Effect.runPromise(assetArchive(packager, container, changed, work));
  const recorded: AssetManifest = JSON.parse(readFileSync(incremental.replace(/\.w3x$/, ".json"), "utf8"));
  expect(recorded.generation).toBe(1);
  expect(recorded.entries).toEqual(assetManifest(container, changed).entries);

  cacheOf("full");
  const full = await Effect.runPromise(assetArchive(packager, container, changed, work));
  expect(JSON.parse(readFileSync(full.replace(/\.w3x$/, ".json"), "utf8")).generation).toBe(0);
  expect(await extractAll(incremental, changed)).toEqual(await extractAll(full, changed));
  expect(readFileSync(incremental)).not.toEqual(readFileSync(join(archives, first[0]!.replace(/\.json$/, ".w3x"))));
});

test("[invariant] a cached archive is no base when its container differs, it holds an entry the build lacks, or its chain of incremental builds is long", () => {
  const wanted = manifest(0, "a", { x: "1", y: "2" });
  const base = (key: string, generation: number, container: string, entries: Record<string, string>) => ({ key, manifest: manifest(generation, container, entries) });
  expect(nearestAssetArchive([base("other", 0, "b", { x: "1", y: "2" })], wanted)).toBeUndefined();
  expect(nearestAssetArchive([base("extra", 0, "a", { x: "1", z: "3" })], wanted)).toBeUndefined();
  expect(nearestAssetArchive([base("tall", 8, "a", { x: "1", y: "2" })], wanted)).toBeUndefined();
  expect(nearestAssetArchive([base("far", 0, "a", { x: "0" }), base("near", 0, "a", { x: "1" })], wanted)?.key).toBe("near");
});
