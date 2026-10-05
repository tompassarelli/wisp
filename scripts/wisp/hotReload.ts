// HotReload: hands a new map bundle to running clients through CustomMapData
// (#36). Every client gets every payload file before any client can read the
// manifest that names them, since the first client to answer makes the others
// load at once; the game installs the bundle in all clients on one frame or in
// none, and each client acknowledges the version it installed. Versions continue
// from the newest manifest on disk, so Wisp and the match can each restart
// without losing track.
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { ackFile, formatManifest, hotFolder, manifestFile, payloadFile, payloadKey } from "../../src/runtime/gameFiles";
import { Acknowledgement, FILE_SLOT_NUMBERS, type MalformedGameFile, hostPath, linePreloadFile, manifestVersion, payloadFileKey, payloadPieces, payloadPreloadFile } from "./boundary";
import { type GameFileFailure, GameFiles, readGameFile } from "./gameFiles";
import { type CompileFailure, MapBuild, type MapBuildFailure } from "./mapBuild";
import type { SourceMapFailure } from "./sourceErrors";
import { step } from "./timings";

const ACK_TIMEOUT_MS = 10_000;
/** Clients written to at once. */
const PUBLISH_CONCURRENCY = 2;

/** Some clients didn't acknowledge a version in time; the game installs a version in every client or none. */
export class NotAcknowledged extends Schema.TaggedError<NotAcknowledged>()("NotAcknowledged", {
  version: Schema.Number,
  directories: Schema.Array(Schema.String),
  /** Malformed acknowledgements seen while waiting. */
  problems: Schema.Array(Schema.String),
}) {
  override get message(): string {
    const problems = this.problems.length === 0 ? "" : `; ${this.problems.join("; ")}`;
    return `v${this.version} NOT acknowledged by ${this.directories.join(", ")} within ${ACK_TIMEOUT_MS / 1000} s${problems}`;
  }
}

export type HotReloadFailure = CompileFailure | MapBuildFailure | SourceMapFailure | GameFileFailure | NotAcknowledged;

export class HotReload extends Context.Service<HotReload, {
  /** Compiles the bundle, publishes it to every client and waits for each to install it. Returns its version. */
  readonly publish: Effect.Effect<number, HotReloadFailure>;
}>()("wisp/HotReload") {
  /** Publishes into these clients' CustomMapData folders. */
  static readonly layer = (directories: readonly [string, ...string[]], filePrefix = "wisp") => Layer.effect(HotReload, Effect.gen(function*() {
    const files = yield* GameFiles;
    const build = yield* MapBuild;
    const folder = (directory: string) => join(directory, hotFolder(filePrefix));
    const published = yield* Effect.forEach(directories, (directory) =>
      files.list(folder(directory)).pipe(Effect.map((names) => Math.max(0, ...names.map(manifestVersion).filter((version) => version !== undefined)))),
    { concurrency: PUBLISH_CONCURRENCY });
    let version = Math.max(...published);
    // The previous payload stays until the next publish: a client may still be reading it.
    let previousKey = "";

    const forEachClient = <E>(write: (directory: string) => Effect.Effect<void, E>) =>
      Effect.forEach(directories, write, { concurrency: PUBLISH_CONCURRENCY, discard: true });

    const publishFiles = (current: number, bundleChecksum: string, pieces: readonly Uint8Array[]) => Effect.gen(function*() {
      yield* forEachClient((directory) => Effect.forEach(pieces, (piece, index) =>
        files.write(hostPath(directory, payloadFile(bundleChecksum, index, filePrefix)), piece), { discard: true }));
      const manifest = linePreloadFile(formatManifest({ version: current, files: pieces.length, checksum: bundleChecksum }));
      yield* forEachClient((directory) => files.replace(hostPath(directory, manifestFile(current, filePrefix)), manifest));
      const kept = new Set([payloadKey(bundleChecksum), previousKey]);
      // Manifests stay: the map finds the newest version by searching them.
      yield* forEachClient((directory) => Effect.gen(function*() {
        const stale = (yield* files.list(folder(directory))).filter((name) => {
          const key = payloadFileKey(name);
          return key !== undefined && !kept.has(key);
        });
        yield* Effect.forEach(stale, (name) => files.remove(join(folder(directory), name)), { discard: true });
      }));
    });

    /** Waits until every client acknowledges `current` or a later version. */
    const acknowledgements = (current: number) => Effect.gen(function*() {
      const deadline = (yield* Clock.currentTimeMillis) + ACK_TIMEOUT_MS;
      const pending = new Set(directories);
      const problems = new Map<string, MalformedGameFile>();
      while (true) {
        for (const directory of [...pending]) {
          for (const slot of FILE_SLOT_NUMBERS) {
            // A file the game is still writing can read as malformed; it is read again on the next poll.
            const acknowledged = yield* readGameFile(join(directory, ackFile(slot, filePrefix)), Acknowledgement).pipe(
              Effect.provideService(GameFiles, files),
              Effect.catchTag("MalformedGameFile", (problem) => Effect.sync(() => {
                problems.set(directory, problem);
                return undefined;
              })),
            );
            if (acknowledged !== undefined && acknowledged.value.version >= current) {
              pending.delete(directory);
              problems.delete(directory);
            }
          }
        }
        if (pending.size === 0) return;
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return yield* new NotAcknowledged({ version: current, directories: [...pending], problems: [...problems.values()].map((problem) => problem.message) });
        }
        yield* Effect.sleep("5 millis");
      }
    });

    const publish = Effect.gen(function*() {
      const bundle = yield* build.compile;
      const pieces = payloadPieces(bundle.bytes).map(payloadPreloadFile);
      const current = ++version;
      yield* Effect.uninterruptible(publishFiles(current, bundle.checksum, pieces))
        .pipe(step(`publish v${current}: ${bundle.bytes.length} bytes in ${pieces.length} file(s)`));
      previousKey = payloadKey(bundle.checksum);
      yield* acknowledgements(current).pipe(step(`v${current} running in ${directories.length} client(s)`));
      return current;
    });

    return HotReload.of({ publish });
  }));
}
