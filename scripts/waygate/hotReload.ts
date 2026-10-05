// HotReload: hands a new map bundle to running clients through CustomMapData
// (#36). Each client gets every payload file before the manifest that names
// them; the game installs the bundle in all clients on one frame or in none,
// and each client acknowledges the version it installed. Versions continue
// from the newest manifest on disk, so Waygate and the match can each restart
// without losing track.
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { ackFile, formatManifest, manifestFile, payloadFile, payloadKey } from "../../src/runtime/gameFiles";
import { Acknowledgement, FILE_SLOT_NUMBERS, type MalformedGameFile, linePreloadFile, manifestVersion, payloadFileKey, payloadPieces, payloadPreloadFile } from "./boundary";
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
}>()("waygate/HotReload") {
  /** Publishes into these clients' CustomMapData folders. */
  static readonly layer = (directories: readonly [string, ...string[]], filePrefix = "waygate") => Layer.effect(HotReload, Effect.gen(function*() {
    const files = yield* GameFiles;
    const build = yield* MapBuild;
    const published = yield* Effect.forEach(directories, (directory) =>
      files.list(directory).pipe(Effect.map((names) => Math.max(0, ...names.map((name) => manifestVersion(name, filePrefix)).filter((version) => version !== undefined)))),
    { concurrency: PUBLISH_CONCURRENCY });
    let version = Math.max(...published);
    // The previous payload stays until the next publish: a client may still be reading it.
    let previousKey = "";

    const publishTo = (directory: string, current: number, bundleChecksum: string, pieces: readonly Uint8Array[]) => Effect.gen(function*() {
      for (const [index, piece] of pieces.entries()) yield* files.write(join(directory, payloadFile(bundleChecksum, index, filePrefix)), payloadPreloadFile(piece));
      // The manifest follows the payload: a client that reads it can read every payload file.
      yield* files.replace(join(directory, manifestFile(current, filePrefix)), linePreloadFile(formatManifest({ version: current, files: pieces.length, checksum: bundleChecksum })));
      const kept = new Set([payloadKey(bundleChecksum), previousKey]);
      // Manifests stay: the map finds the newest version by searching them.
      const stale = (yield* files.list(directory)).filter((name) => {
        const key = payloadFileKey(name, filePrefix);
        return key !== undefined && !kept.has(key);
      });
      yield* Effect.forEach(stale, (name) => files.remove(join(directory, name)), { discard: true });
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
      const pieces = payloadPieces(bundle.bytes);
      const current = ++version;
      yield* Effect.uninterruptible(Effect.forEach(directories, (directory) => publishTo(directory, current, bundle.checksum, pieces), {
        concurrency: PUBLISH_CONCURRENCY,
        discard: true,
      })).pipe(step(`publish v${current}: ${bundle.bytes.length} bytes in ${pieces.length} file(s)`));
      previousKey = payloadKey(bundle.checksum);
      yield* acknowledgements(current).pipe(step(`v${current} running in ${directories.length} client(s)`));
      return current;
    }).pipe(step("reload", { root: true }));

    return HotReload.of({ publish });
  }));
}
