











import { join } from "node:path";
import { Context, Effect, Layer, Schedule, Schema } from "effect";
import { type Manifest, NO_BASE, ackFile, formatManifest, hotFolder, manifestFile, payloadKey } from "../../src/runtime/gameFiles";
import { ModulePublisher, type ModuleSet, type VersionFiles, moduleChunk } from "../../src/runtime/modules";
import type { BundledModule, BundledModules } from "../luaBundle";
import { Acknowledgement, FILE_SLOT_NUMBERS, type MalformedGameFile, hostPath, linePreloadFile, manifestVersion, payloadFileKey, payloadPreloadFile } from "./boundary";
import { type GameFileFailure, GameFiles, prepareHotFolders, readGameFile } from "./gameFiles";
import { type CompileFailure, MapBuild, type MapBuildFailure } from "./mapBuild";
import { type SourceMapFailure, SourceErrors } from "./sourceErrors";
import { step } from "./timings";

const ACK_TIMEOUT_MS = 10_000;

const PUBLISH_CONCURRENCY = 2;


export class NotAcknowledged extends Schema.TaggedError<NotAcknowledged>()("NotAcknowledged", {
  version: Schema.Finite,
  directories: Schema.Array(Schema.String),

  problems: Schema.Array(Schema.String),
}) {
  override get message(): string {
    const problems = this.problems.length === 0 ? "" : `; ${this.problems.join("; ")}`;
    return `v${this.version} NOT acknowledged by ${this.directories.join(", ")} within ${ACK_TIMEOUT_MS / 1000} s${problems}`;
  }
}

export type HotReloadFailure = CompileFailure | MapBuildFailure | SourceMapFailure | GameFileFailure | NotAcknowledged;


const versionKeys = ({ state, base }: Manifest) => (base === NO_BASE ? [payloadKey(state)] : [payloadKey(state), `${payloadKey(state)}-${payloadKey(base)}`]);

export class HotReload extends Context.Service<HotReload, {

  readonly publish: Effect.Effect<number, HotReloadFailure>;
}>()("wisp/HotReload") {

  static readonly layer = (directories: readonly [string, ...string[]], filePrefix = "wisp") => Layer.effect(HotReload, Effect.gen(function*() {
    const files = yield* GameFiles;
    const build = yield* MapBuild;
    const sourceErrors = yield* SourceErrors;
    const folder = (directory: string) => join(directory, hotFolder(filePrefix));

    yield* prepareHotFolders(directories, filePrefix);
    const published = yield* Effect.forEach(directories, (directory) =>
      files.list(folder(directory)).pipe(Effect.map((names) => Math.max(0, ...names.map(manifestVersion).filter((version) => version !== undefined)))),
    { concurrency: PUBLISH_CONCURRENCY });
    let version = Math.max(...published);
    const publisher = new ModulePublisher(filePrefix);

    const chunks = new WeakMap<BundledModule, string>();
    const chunk = (module: BundledModule) => {
      let text = chunks.get(module);
      if (text === undefined) {
        text = Buffer.from(moduleChunk(module.code), "utf8").toString("latin1");
        chunks.set(module, text);
      }
      return text;
    };

    let retained = new Map<string, BundledModule>();

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

      yield* forEachClient((directory) => Effect.gen(function*() {
        const stale = (yield* files.list(folder(directory))).filter((name) => {
          const key = payloadFileKey(name);
          return key !== undefined && !kept.has(key);
        });
        yield* Effect.forEach(stale, (name) => files.remove(join(folder(directory), name)), { discard: true });
      }));
    });


    const acknowledgements = (current: number) => {
      const pending = new Set(directories);
      const problems = new Map<string, MalformedGameFile>();
      const look = Effect.gen(function*() {
        for (const directory of [...pending]) {
          for (const slot of FILE_SLOT_NUMBERS) {

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
        return pending.size === 0;
      });
      return look.pipe(
        Effect.repeat({ schedule: Schedule.spaced("5 millis"), until: (done) => done }),
        Effect.timeoutOrElse({
          duration: ACK_TIMEOUT_MS,
          orElse: () => Effect.fail(new NotAcknowledged({ version: current, directories: [...pending], problems: [...problems.values()].map((problem) => problem.message) })),
        }),
        Effect.asVoid,
      );
    };

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

      publisher.installed(versionFiles.published);
      return current;
    });

    return HotReload.of({ publish });
  }));
}
