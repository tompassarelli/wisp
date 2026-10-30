import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { tryMapPromise, tryMapSync } from "../cli/hostProcess";
import { mapPack, type ArchiveEntry } from "../compile/mapBuild";
import { cacheHome } from "../os/xdg";

const ARCHIVE_METADATA = new Set(["(listfile)", "(attributes)", "(signature)"]);
const INDEX = "entries.tsv";

const indexOf = (directory: string) => readFileSync(join(directory, INDEX), "utf8").split("\n").filter((line) => line !== "")
  .map((line): ArchiveEntry => {
    const [entry = "", file = ""] = line.split("\t");
    return { entry, source: join(directory, file) };
  });

/**
 * Every file a map archive carries, unpacked once into the user's cache keyed by the archive's content, so a player's
 * window reads a downloaded `.w3x` instead of the source tree's import store. Reads the archive with the map packager.
 */
export const extractMapImports = (map: string, packager: string, cache = join(cacheHome(), "wisp/map-imports")) => Effect.gen(function*() {
  const digest = yield* tryMapPromise("hash map", map, async () => createHash("sha256").update(await Bun.file(map).bytes()).digest("hex"));
  const directory = join(cache, digest);
  if (existsSync(join(directory, INDEX))) return yield* tryMapSync("read unpacked map index", directory, () => indexOf(directory));
  yield* tryMapSync("create map import cache", cache, () => mkdirSync(cache, { recursive: true }));
  const scratch = yield* tryMapSync("create scratch directory", cache, () => mkdtempSync(join(cache, `${digest}.`)));
  return yield* Effect.gen(function*() {
    const pack = mapPack(packager);
    const listPath = join(scratch, "listfile");
    yield* pack.extract(map, listPath, "(listfile)");
    const names = (yield* tryMapPromise("read archive file list", listPath, () => Bun.file(listPath).text())).split(/\r?\n/)
      .filter((name) => name !== "" && !ARCHIVE_METADATA.has(name.toLowerCase()));
    const entries = names.map((entry, index): ArchiveEntry => ({ entry, source: join(scratch, String(index)) }));
    yield* pack.extractAll(map, entries, join(scratch, "extract-list"));
    yield* tryMapSync("write unpacked map index", scratch, () => writeFileSync(join(scratch, INDEX), names.map((name, index) => `${name}\t${index}\n`).join("")));
    yield* tryMapSync("install unpacked map", directory, () => {
      try { renameSync(scratch, directory); } catch (cause) { if (!existsSync(join(directory, INDEX))) throw cause; }
    });
    return yield* tryMapSync("read unpacked map index", directory, () => indexOf(directory));
  }).pipe(Effect.ensuring(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));
});
