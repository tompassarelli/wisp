// HotReload: hands a new version of the map's modules to running clients
// through CustomMapData (#36). Every client gets every payload file before any
// client can read the manifest that names them, since the first client to
// answer makes the others load at once; the game installs the version in all
// clients on one frame or in none, and each client acknowledges the version it
// installed. A version carries its full payload and, once every client has
// acknowledged an earlier version, a delta from that version's modules
// (wisp:src/runtime/modules.ts), which is all a client running it reads.
// Versions continue from the newest manifest on disk, so Wisp and the match
// can each restart without losing track; a restarted Wisp knows no base, so
// its first version is read in full. The hot folder and its host marker exist
// before the first publish: see prepareHotFolders.
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { type Manifest, NO_BASE, ackFile, formatManifest, hotFolder, manifestFile, payloadKey } from "../../src/runtime/gameFiles";
import { ModulePublisher, type ModuleSet, type VersionFiles, moduleChunk } from "../../src/runtime/modules";
import type { BundledModule, BundledModules } from "../luaBundle";
import { Acknowledgement, FILE_SLOT_NUMBERS, type MalformedGameFile, hostPath, linePreloadFile, manifestVersion, payloadFileKey, payloadPreloadFile } from "./boundary";
import { type GameFileFailure, GameFiles, prepareHotFolders, readGameFile } from "./gameFiles";
import { type CompileFailure, MapBuild, type MapBuildFailure } from "./mapBuild";
import { type SourceMapFailure, SourceErrors } from "./sourceErrors";
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

/** The payload keys of a version's files: its full payload's and its delta's. */
const versionKeys = ({ state, base }: Manifest) => (base === NO_BASE ? [payloadKey(state)] : [payloadKey(state), `${payloadKey(state)}-${payloadKey(base)}`]);

export class HotReload extends Context.Service<HotReload, {
  /** Compiles the map, publishes it to every client and waits for each to install it. Returns its version. */
  readonly publish: Effect.Effect<number, HotReloadFailure>;
}>()("wisp/HotReload") {
  /** Publishes into these clients' CustomMapData folders. */
  static readonly layer = (directories: readonly [string, ...string[]], filePrefix = "wisp") => Layer.effect(HotReload, Effect.gen(function*() {
    const files = yield* GameFiles;
    const build = yield* MapBuild;
    const sourceErrors = yield* SourceErrors;
    const folder = (directory: string) => join(directory, hotFolder(filePrefix));
    // Before any reload: a map that has seen no host looks only twice a second and polls fast once it has.
    yield* prepareHotFolders(directories, filePrefix);
    const published = yield* Effect.forEach(directories, (directory) =>
      files.list(folder(directory)).pipe(Effect.map((names) => Math.max(0, ...names.map(manifestVersion).filter((version) => version !== undefined)))),
    { concurrency: PUBLISH_CONCURRENCY });
    let version = Math.max(...published);
    const publisher = new ModulePublisher(filePrefix);
    // A module's chunk as the bytes Lua reads, one character per byte; the compiler keeps an unchanged module's object.
    const chunks = new WeakMap<BundledModule, string>();
    const chunk = (module: BundledModule) => {
      let text = chunks.get(module);
      if (text === undefined) {
        text = Buffer.from(moduleChunk(module.code), "utf8").toString("latin1");
        chunks.set(module, text);
      }
      return text;
    };
    // The module each kept source map came from, by key: a module compiled again keeps its map again.
    let retained = new Map<string, BundledModule>();
    // The previous version's payloads stay until the next publish: a client may still be reading them.
    let previousKeys: readonly string[] = [];

    const forEachClient = <E>(write: (directory: string) => Effect.Effect<void, E>) =>
      Effect.forEach(directories, write, { concurrency: PUBLISH_CONCURRENCY, discard: true });

    const retainSourceMaps = (compiled: BundledModules, current: VersionFiles) => Effect.gen(function*() {
      const kept = new Map<string, BundledModule>();
      for (const module of compiled.modules) {
        const key = payloadKey(current.published.hashes[module.name] ?? "");
        if (retained.get(key) !== module) yield* sourceErrors.retainModule(key, module.sourceMap());
        kept.set(key, module);
      }
      retained = kept;
    });

    const publishFiles = (current: VersionFiles) => Effect.gen(function*() {
      const payloads = current.payloads.map(([name, text]) => [name, payloadPreloadFile(Buffer.from(text, "latin1"))] as const);
      yield* forEachClient((directory) => Effect.forEach(payloads, ([name, file]) => files.write(hostPath(directory, name), file), { discard: true }));
      const manifest = linePreloadFile(formatManifest(current.manifest));
      yield* forEachClient((directory) => files.replace(hostPath(directory, manifestFile(current.manifest.version, filePrefix)), manifest));
      const kept = new Set([...versionKeys(current.manifest), ...previousKeys]);
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
      const compiled = yield* build.compile;
      const set: ModuleSet = { entry: compiled.entry, modules: compiled.modules.map((module) => ({ name: module.name, text: chunk(module) })) };
      const current = ++version;
      const versionFiles = publisher.files(current, set);
      const { changed, changedBytes, fullBytes, payloads } = versionFiles;
      yield* Effect.uninterruptible(Effect.andThen(retainSourceMaps(compiled, versionFiles), publishFiles(versionFiles)))
        .pipe(step(`publish v${current}: ${changed.length} of ${set.modules.length} module(s), ${changedBytes} of ${fullBytes} bytes, ${payloads.length} file(s)`));
      previousKeys = versionKeys(versionFiles.manifest);
      yield* acknowledgements(current).pipe(step(`v${current} running in ${directories.length} client(s)`));
      // Every client runs this version's modules: the next version can send only what changed.
      publisher.installed(versionFiles.published);
      return current;
    });

    return HotReload.of({ publish });
  }));
}
