// GameFiles: the client folders Wisp shares with the game. Files in a
// client's CustomMapData carry hot reloads, acknowledgements, error reports and
// ready signals; its Maps folder takes the map a fresh match hosts.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, copyFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { hostFile } from "../../src/runtime/gameFiles";
import { type GameFileKind, MalformedGameFile, hostPath, linePreloadFile } from "./boundary";
import { describeCause } from "./command";

export class GameFileFailure extends Schema.TaggedError<GameFileFailure>()("GameFileFailure", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.path}: ${describeCause(this.cause)}`;
  }
}

export interface StoredFile {
  readonly text: string;
  /** Milliseconds since the epoch, on the Effect Clock's scale. */
  readonly modified: number;
}

export class GameFiles extends Context.Service<GameFiles, {
  /** A file's text and modification time; undefined while it doesn't exist. */
  readonly read: (path: string) => Effect.Effect<StoredFile | undefined, GameFileFailure>;
  readonly write: (path: string, contents: string | Uint8Array) => Effect.Effect<void, GameFileFailure>;
  /** Written whole: a reader sees the old file or the new one. */
  readonly replace: (path: string, text: string) => Effect.Effect<void, GameFileFailure>;
  /** File names in a directory; none while it doesn't exist. */
  readonly list: (directory: string) => Effect.Effect<readonly string[], GameFileFailure>;
  readonly remove: (path: string) => Effect.Effect<void, GameFileFailure>;
  /** Makes `map` the one map in the configured map folder of the client whose Documents/Warcraft III is `documents`. */
  readonly installMap: (documents: string, map: string) => Effect.Effect<void, GameFileFailure>;
}>()("wisp/GameFiles") {
  static readonly layer = (options: MapDirectories = { mapFolder: "Maps/00-Wisp", replacedMaps: "wisp-replaced-maps" }) => Layer.sync(GameFiles, () => GameFiles.of(local(options)));
}

/** A client's CustomMapData, given its Documents/Warcraft III folder. */
export const dataDirectory = (documents: string) => join(documents, "CustomMapData");

/**
 * Creates the hot folder of each client's CustomMapData with the host's
 * marker, unless the marker is already there. Run it before a match starts or
 * a reload is published: under Wine a map's lookup of a missing file reads all
 * of CustomMapData while its hot folder is missing, and a map that has seen
 * neither the marker nor a manifest looks for them at most twice a second.
 */
export const prepareHotFolders = (directories: readonly string[], filePrefix = "wisp") =>
  Effect.gen(function*() {
    const files = yield* GameFiles;
    yield* Effect.forEach(directories, (directory) => Effect.gen(function*() {
      const marker = hostPath(directory, hostFile(filePrefix));
      // The marker's content never changes, and a client may be reading it.
      if ((yield* files.read(marker)) === undefined) yield* files.write(marker, linePreloadFile("host"));
    }), { concurrency: 2, discard: true });
  });

export interface MapDirectories {
  readonly mapFolder: string;
  readonly replacedMaps: string;
}

/** A file the game writes, decoded; undefined while it doesn't exist. */
export const readGameFile = <A>(path: string, kind: GameFileKind<A>) =>
  Effect.gen(function*() {
    const files = yield* GameFiles;
    const stored = yield* files.read(path);
    if (stored === undefined) return undefined;
    return { value: yield* kind.decode(path, stored.text), modified: stored.modified };
  });

const tryPromise = <A>(operation: string, path: string, run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new GameFileFailure({ operation, path, cause }) });

const trySync = <A>(operation: string, path: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new GameFileFailure({ operation, path, cause }) });

const FileSystemFailure = Schema.Struct({ code: Schema.String });
// A client reading a file can briefly hold it on Proton.
const transientFileErrors = new Set(["EAGAIN", "EBUSY"]);

function isTransient(failure: GameFileFailure): boolean {
  const decoded = Schema.decodeUnknownOption(FileSystemFailure)(failure.cause);
  return Option.isSome(decoded) && transientFileErrors.has(decoded.value.code);
}

const retryTransient = <A>(effect: Effect.Effect<A, GameFileFailure>) => Effect.retry(effect, { times: 2, while: isTransient });

const write = (path: string, contents: string | Uint8Array) =>
  retryTransient(tryPromise("write game file", path, async () => {
    await Bun.write(path, contents);
  }));

const local = ({ mapFolder, replacedMaps }: MapDirectories): GameFiles["Service"] => ({
  // Game files are small and polled every few milliseconds while a reload waits, so they are read synchronously.
  read: (path) => trySync("read game file", path, () => {
    const stats = statSync(path, { throwIfNoEntry: false });
    return stats === undefined ? undefined : { text: readFileSync(path, "utf8"), modified: stats.mtimeMs };
  }),
  write,
  replace: (path, text) => Effect.gen(function*() {
    yield* write(`${path}.next`, text);
    yield* retryTransient(trySync("replace game file", path, () => renameSync(`${path}.next`, path)));
  }),
  list: (directory) => trySync("list game files", directory, () => (existsSync(directory) ? readdirSync(directory) : [])),
  remove: (path) => trySync("remove game file", path, () => rmSync(path)),
  installMap: (documents, map) => trySync("install map", join(documents, mapFolder), () => {
    const folder = join(documents, mapFolder);
    const replaced = join(documents, replacedMaps);
    mkdirSync(folder, { recursive: true });
    mkdirSync(replaced, { recursive: true });
    for (const old of readdirSync(folder).filter((name) => name.endsWith(".w3x") && name !== basename(map))) renameSync(join(folder, old), join(replaced, old));
    // A running game may still read the old file: replace it by rename, never in place.
    const next = join(folder, `${basename(map)}.next`);
    copyFileSync(map, next);
    renameSync(next, join(folder, basename(map)));
  }),
});

export { MalformedGameFile };
