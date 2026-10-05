// MapBuild: compiling the map bundle, the TypeScript-only map build and the
// script-only rebuild (#35, #36). Every step that writes a map works on a
// staged copy that replaces the old map only when every step passed; child
// processes stop when their step is interrupted.
//
// A World Editor base map is a small MPQ whose hash table cannot take many
// imported assets, so a map with imports packages into a copy of a fully
// packaged private map, its container (mitigation until map-pack can grow an
// archive). Without a container the build packages into a copy of the base.
// The copy's script, object data, description and header are replaced with
// TypeScript-generated ones; every other base map file and every declared
// import must equal its source. Imports the build does not declare stay
// unverified.
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Console, Context, Effect, Layer, Schema } from "effect";
import { payloadKey } from "../../src/runtime/gameFiles";
import { decodeMapInfo, declareMap, encodeMapInfo, mapConfig, mapHeader, type MapDeclaration } from "../mapInfo";
import { type Bundle, composeScript, typescriptBase } from "../mapScript";
import { abilityData } from "../objectData";
import { bytesChecksum } from "./boundary";
import { describeCause } from "./command";
import type { Phase } from "../compiler";
import { type SourceMapFailure, SourceErrors } from "./sourceErrors";
import { step } from "./timings";

export interface BuildProject {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly bundlePath: string;
  readonly compileInputs: readonly string[];
  readonly packager: string;
  readonly toolchainLockPath: string;
  readonly packageDirectory: string;
  readonly entryGlobal?: string;
}

export class MapBuildFailure extends Schema.TaggedError<MapBuildFailure>()("MapBuildFailure", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.path}: ${describeCause(this.cause)}`;
  }
}

/** The map code doesn't compile; `diagnostics` is the compiler's report. */
export class CompileFailure extends Schema.TaggedError<CompileFailure>()("CompileFailure", {
  diagnostics: Schema.String,
}) {
  override get message(): string {
    return this.diagnostics;
  }
}

export interface CompiledBundle extends Bundle {
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

export interface GeneratedFile {
  readonly entry: string;
  readonly contents: Uint8Array;
}

export interface BuildOptions {
  readonly base: string;
  /** The packaged map that carries the imports; the base map when absent. */
  readonly container?: string;
  readonly name: string;
  readonly out: string;
  readonly packager?: string;
  readonly declaration: MapDeclaration;
  /** Generated object-data files; without a war3map.w3a the build adds one holding only FileIO's ability. */
  readonly objectData?: readonly GeneratedFile[];
  readonly imports?: readonly ArchiveEntry[];
}

export type BuildFailure = MapBuildFailure | CompileFailure | SourceMapFailure;
type CompilerModule = typeof import("../compiler");

export class MapBuild extends Context.Service<MapBuild, {
  /** Compiles the map bundle with a compiler kept warm between calls, and keeps its source map. */
  readonly compile: Effect.Effect<CompiledBundle, BuildFailure>;
  /**
   * A map whose project code is only the TypeScript bundle, started from
   * the supplied entry module. Like `rebuild`, it reuses the compiled bundle
   * while that is newer than everything the compile reads.
   */
  readonly build: (options: BuildOptions) => Effect.Effect<void, BuildFailure>;
  /** Replaces only war3map.lua of a map built by `build`. */
  readonly rebuild: (map: string, packager?: string) => Effect.Effect<void, BuildFailure>;
}>()("wisp/MapBuild") {
  static layer(project: BuildProject) {
    const { configPath, bundlePath, compileInputs } = project;
    return Layer.effect(MapBuild, Effect.gen(function*() {
      const sourceErrors = yield* SourceErrors;
      // The compiler API takes about 0.6 s to load, so it loads on the first compile.
      let compiler: Promise<{ readonly run: ReturnType<CompilerModule["mapCompiler"]>; readonly report: CompilerModule["report"] }> | undefined;
      const warmCompiler = () => (compiler ??= import("../compiler").then(({ mapCompiler, report }) => ({ run: mapCompiler(configPath), report })));
      /** The compiled bundle on disk, its source map kept under its key. */
      const compiled = Effect.gen(function*() {
        const bytes = yield* tryMapPromise("read map bundle", bundlePath, () => Bun.file(bundlePath).bytes());
        const bundleChecksum = bytesChecksum(bytes);
        const key = payloadKey(bundleChecksum);
        yield* sourceErrors.retain(bundlePath, key);
        return { text: new TextDecoder().decode(bytes), key, bytes, checksum: bundleChecksum } satisfies CompiledBundle;
      });
      /** A map command times the compiler's loading and phases as steps; `hot` keeps its reload timeline short. */
      const compileBundle = (measured: boolean) => Effect.gen(function*() {
        const load = tryMapPromise("load the map compiler", configPath, warmCompiler);
        const { run, report } = yield* measured ? load.pipe(step("load compiler")) : load;
        const context = yield* Effect.context<never>();
        const phase: Phase = (name, work) => Effect.runSyncWith(context)(Effect.sync(work).pipe(step(name)));
        const diagnostics = yield* tryMapSync("compile map", configPath, () => measured ? run(phase) : run());
        if (diagnostics.length > 0) return yield* new CompileFailure({ diagnostics: report(diagnostics) });
        return yield* compiled;
      }).pipe(step("compile"));
      const compile = compileBundle(false);
      // `hot` compiles every save into the same bundle, so a map command usually finds it current.
      const currentBundle = Effect.gen(function*() {
        const age = yield* tryMapSync("check compiled bundle", bundlePath, () => freshBundleAge(bundlePath, compileInputs, Date.now()));
        if (age === undefined) return yield* compileBundle(true);
        return yield* compiled.pipe(step(`script reused (compiled ${age.toFixed(0)} s ago)`));
      });
      return MapBuild.of({
        compile,
        build: (options) => buildTypescriptMap(project, options, currentBundle),
        rebuild: (map, packager) => rebuildMap(map, currentBundle, packager ?? project.packager, project.entryGlobal),
      });
    }));
  }
}

/** The newest modification time under `path`: a file's own, or a directory's newest file's. */
function newestModification(path: string): number {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return readdirSync(path).reduce((newest, name) => Math.max(newest, newestModification(join(path, name))), 0);
}

/**
 * Seconds since `bundle` was compiled when it and its source map exist and
 * it is newer than every file under `inputs`; undefined when it must be
 * compiled again.
 */
export function freshBundleAge(bundle: string, inputs: readonly string[], now: number): number | undefined {
  if (!existsSync(bundle) || !existsSync(`${bundle}.map`)) return undefined;
  const compiledAt = statSync(bundle).mtimeMs;
  return inputs.every((input) => newestModification(input) < compiledAt) ? (now - compiledAt) / 1000 : undefined;
}

const rebuildMap = (map: string, compile: Effect.Effect<CompiledBundle, BuildFailure>, packager: string, entryGlobal?: string) => Effect.scoped(Effect.gen(function*() {
  yield* ensurePackager(packager);
  const bundle = yield* compile;
  const basePath = `${map}.base.lua`;
  const base = yield* tryMapPromise("read base script", basePath, () => Bun.file(basePath).text());
  const script = yield* tryMapSync("compose map script", basePath, () => composeScript(base, bundle, entryGlobal));
  const scriptPath = `${map}.lua`;
  yield* tryMapPromise("write map script", scriptPath, () => Bun.write(scriptPath, script));
  const work = yield* workDirectory(dirname(map));
  yield* stageMap(map, map, (staged) => Effect.gen(function*() {
    yield* mapPack(packager).replace(staged, scriptPath);
    yield* verifyArchive(packager, staged, [{ entry: "war3map.lua", source: scriptPath }], work);
  })).pipe(step("package and verify"));
  yield* Console.log(`rebuilt ${map}`);
}));

/** The base map's other files (terrain, doodads, strings ...), which the container must carry unchanged. */
const baseMapFiles = (packager: string, base: string, generated: ReadonlySet<string>, work: string) => Effect.gen(function*() {
  const listPath = join(work, "base-listfile");
  yield* mapPack(packager).extract(base, listPath, "(listfile)");
  const list = yield* tryMapPromise("read base map file list", base, () => Bun.file(listPath).text());
  const entries = list.split(/\r?\n/).filter((entry) => entry.length > 0 && !generated.has(entry));
  return yield* Effect.forEach(entries, (entry, index) => {
    const source = join(work, `base-${index}`);
    return mapPack(packager).extract(base, source, entry).pipe(Effect.as({ entry, source } satisfies ArchiveEntry));
  }, { concurrency: 4 });
});

/**
 * Puts the 512-byte map header in front of the archive: over the existing
 * one, or before an archive saved without one, since MPQ readers find the
 * archive at any 512-byte boundary.
 */
export const writeHeader = (map: string, header: Uint8Array) => tryMapSync("write map header", map, () => {
  const file = openSync(map, "r+");
  let magic = "";
  try {
    const bytes = new Uint8Array(4);
    readSync(file, bytes, 0, bytes.length, 0);
    magic = new TextDecoder().decode(bytes);
    if (magic === "HM3W") writeSync(file, header, 0, header.length, 0);
  } finally {
    closeSync(file);
  }
  if (magic === "HM3W") return;
  if (magic !== "MPQ\x1a") throw new Error("map is neither a map header nor an MPQ archive");
  writeFileSync(map, Buffer.concat([header, readFileSync(map)]));
});

const buildTypescriptMap = (project: BuildProject, options: BuildOptions, compile: Effect.Effect<CompiledBundle, BuildFailure>) => Effect.scoped(Effect.gen(function*() {
  const out = resolve(options.out);
  if (!relative(project.projectRoot, out).startsWith("..")) {
    return yield* new MapBuildFailure({ operation: "check output", path: out, cause: "maps contain private assets and must be built outside the checkout" });
  }
  const packager = options.packager ?? project.packager;
  const pack = mapPack(packager);
  yield* verifyToolchain(project.toolchainLockPath, project.packageDirectory).pipe(step("verify toolchain"));
  yield* ensurePackager(packager);
  const work = yield* workDirectory(dirname(out));
  const bundle = yield* compile;

  const { generated, files, assets } = yield* Effect.gen(function*() {
    const baseScriptPath = join(work, "base.war3map.lua");
    const baseInfoPath = join(work, "base.war3map.w3i");
    const [baseScript, baseInfo] = yield* Effect.gen(function*() {
      yield* pack.extract(options.base, baseScriptPath);
      yield* pack.extract(options.base, baseInfoPath, "war3map.w3i");
      return yield* tryMapPromise("read base map", options.base, () =>
        Promise.all([Bun.file(baseScriptPath).text(), Bun.file(baseInfoPath).bytes()]));
    }).pipe(step("extract base script"));
    const generated = yield* tryMapSync("generate map files", options.base, () => {
      const info = declareMap(decodeMapInfo(baseInfo), options.name, options.declaration);
      const base = typescriptBase(baseScript, mapConfig(info));
      return {
        base,
        header: mapHeader(info),
        files: [
          { entry: "war3map.lua", contents: new TextEncoder().encode(composeScript(base, bundle, project.entryGlobal)) },
          { entry: "war3map.w3i", contents: encodeMapInfo(info) },
          ...withFileIo(options.objectData),
        ],
      };
    });
    const files = generated.files.map((file) => ({ ...file, source: join(work, file.entry) }));
    yield* Effect.forEach(files, ({ source, contents }) =>
      tryMapPromise("write generated file", source, () => Bun.write(source, contents)), { discard: true });
    const scriptPath = join(work, "war3map.lua");
    yield* runProcess("check map script syntax", scriptPath, ["nix", "shell", "nixpkgs#lua5_3", "--command", "luac", "-p", scriptPath]).pipe(step("check script syntax"));
    const assets = [
      ...yield* baseMapFiles(packager, options.base, new Set(files.map(({ entry }) => entry)), work).pipe(step("extract base files")),
      ...options.imports ?? [],
    ];
    return { generated, files, assets };
  }).pipe(step("generate"));

  yield* stageMap(options.container ?? options.base, out, (staged) => Effect.gen(function*() {
    yield* Effect.gen(function*() {
      for (const file of files) yield* pack.replace(staged, file.source, file.entry);
      yield* writeHeader(staged, generated.header);
    }).pipe(step("package"));
    yield* Effect.gen(function*() {
      const header = yield* tryMapPromise("read map header", staged, () => Bun.file(staged).slice(0, generated.header.length).bytes());
      if (Buffer.compare(header, generated.header) !== 0) {
        return yield* new MapBuildFailure({ operation: "verify map header", path: staged, cause: "header differs from the generated one" });
      }
      yield* verifyArchive(packager, staged, [...files, ...assets], work);
    }).pipe(step(`verify ${files.length + assets.length} entries`));
  }));
  yield* tryMapPromise("keep base script for rebuilds", `${out}.base.lua`, () => Bun.write(`${out}.base.lua`, generated.base));
  yield* Console.log(`built ${out}`);
}));

// ---------------------------------------------------------------- operations

/** Hot reload reads files through FileIO's ability; object data without a war3map.w3a gets one holding only that ability. */
export function withFileIo(objectData: readonly GeneratedFile[] = []): readonly GeneratedFile[] {
  return objectData.some(({ entry }) => entry === "war3map.w3a") ? objectData : [...objectData, { entry: "war3map.w3a", contents: abilityData() }];
}

const PACKAGER_SOURCE = join(import.meta.dir, "../../native/map-pack.c");

/** The map packager at `path`; when it is missing, compiles wisp:native/map-pack.c there against nixpkgs StormLib. */
export const ensurePackager = (path: string) => Effect.suspend(() => existsSync(path) ? Effect.void : Effect.gen(function*() {
  const stormlib = yield* captureProcess("build StormLib", path, ["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#stormlib"]).pipe(
    Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0
      ? Effect.succeed(stdout.trim().split("\n")[0] ?? "")
      : Effect.fail(new MapBuildFailure({ operation: "build StormLib", path, cause: `nix exited with ${exitCode}: ${stderr.trim()}` }))),
  );
  yield* tryMapSync("create packager directory", path, () => mkdirSync(dirname(path), { recursive: true }));
  yield* runProcess("compile map packager", path, ["nix", "shell", "nixpkgs#gcc", "--command", "gcc", `-I${stormlib}/include`, PACKAGER_SOURCE,
    `-L${stormlib}/lib`, `-Wl,-rpath,${stormlib}/lib`, "-lstorm", "-o", `${path}.next`]);
  yield* tryMapSync("install map packager", path, () => renameSync(`${path}.next`, path));
}).pipe(step("compile map packager")));

const tryMapPromise = <A>(operation: string, path: string, run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new MapBuildFailure({ operation, path, cause }) });

const tryMapSync = <A>(operation: string, path: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new MapBuildFailure({ operation, path, cause }) });

/** Captures a child's result; interruption kills and reaps the owned child. */
export const captureProcess = (
  operation: string,
  path: string,
  command: readonly string[],
  options: { readonly env?: Record<string, string>; readonly stdout?: "pipe" | "ignore" } = {},
) =>
  Effect.acquireUseRelease(
    tryMapSync(operation, path, () => Bun.spawn([...command], {
      ...options, stdin: "ignore", stdout: options.stdout ?? "pipe", stderr: "pipe",
    })),
    (child) => tryMapPromise(operation, path, async () => {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        child.stdout === null ? "" : new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    }),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }),
  );

/** Runs a command to completion; interrupting the step kills and reaps it. */
export const runProcess = (operation: string, path: string, command: readonly string[]) =>
  captureProcess(operation, path, command, { stdout: "ignore" }).pipe(Effect.flatMap(({ exitCode, stderr }) =>
    exitCode === 0
      ? Effect.void
      : Effect.fail(new MapBuildFailure({ operation, path, cause: `${command[0]} exited with ${exitCode}: ${stderr.trim()}` })),
  ));

/** The supplied map packager: extracts or replaces one archive entry, war3map.lua by default. */
function mapPack(packager: string) {
  return {
    extract: (archive: string, file: string, entry = "war3map.lua") =>
      runProcess(`extract ${entry}`, archive, [packager, "extract", archive, file, entry]),
    replace: (archive: string, file: string, entry = "war3map.lua") =>
      runProcess(`replace ${entry}`, archive, [packager, "replace", archive, file, entry]),
  };
}

/** A temporary directory under `parent`, removed with its scope. */
const workDirectory = (parent: string) =>
  Effect.acquireRelease(
    tryMapSync("create work directory", parent, () => mkdtempSync(join(parent, "ts-map."))),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );

/**
 * Copies `source` to `destination.next`, lets `edit` change and verify the
 * copy, then renames it over `destination`. A failed or interrupted edit
 * removes the copy and leaves `destination` as it was.
 */
export const stageMap = <E>(source: string, destination: string, edit: (staged: string) => Effect.Effect<void, E>) =>
  Effect.acquireUseRelease(
    tryMapSync("stage map", destination, () => {
      copyFileSync(source, `${destination}.next`);
      return `${destination}.next`;
    }),
    (staged) => edit(staged).pipe(Effect.andThen(tryMapSync("publish map", destination, () => renameSync(staged, destination)))),
    (staged) => Effect.sync(() => rmSync(staged, { force: true })),
  );

export interface ArchiveEntry {
  readonly entry: string;
  /** The file whose bytes the archive entry must equal. */
  readonly source: string;
}

/** Extracts every entry, four at a time, and compares it with its source file. */
const verifyArchive = (packager: string, archive: string, entries: readonly ArchiveEntry[], scratch: string) =>
  Effect.forEach(entries, ({ entry, source }, index) => Effect.gen(function*() {
    const extracted = join(scratch, `verify-${index}`);
    yield* mapPack(packager).extract(archive, extracted, entry);
    const [actual, expected] = yield* tryMapPromise("compare archive entry", entry, () =>
      Promise.all([Bun.file(extracted).bytes(), Bun.file(source).bytes()]));
    if (Buffer.compare(actual, expected) !== 0) return yield* new MapBuildFailure({ operation: "compare archive entry", path: entry, cause: `differs from ${source}` });
  }), { concurrency: 4, discard: true });

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, path: string, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError((cause) => new MapBuildFailure({ operation: "decode", path, cause })));

/** A JSON file decoded with `schema`. */
const readJson = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, path: string) =>
  tryMapPromise("read JSON", path, () => Bun.file(path).json()).pipe(Effect.flatMap((json) => decode(schema, path, json)));

const ToolchainLock = Schema.Struct({
  sourceLanguage: Schema.Literal("TypeScript"),
  bun: Schema.String,
  typescriptCompilerApi: Schema.String,
  typescriptChecker: Schema.String,
  typescriptToLua: Schema.String,
  effect: Schema.String,
  effectTsgo: Schema.String,
});
const ProjectPackage = Schema.Struct({
  packageManager: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const InstalledPackage = Schema.Struct({ version: Schema.String });

/**
 * Checks Bun and the declared and installed TypeScript packages against
 * the project's toolchain lock before compiling or packaging the map.
 */
export const verifyToolchain = (lockPath: string, packageDirectory: string) => Effect.gen(function*() {
  const text = yield* tryMapPromise("read toolchain lock", lockPath, () => Bun.file(lockPath).text());
  const lock = yield* decode(ToolchainLock, lockPath, yield* tryMapSync("parse toolchain lock", lockPath, () => Bun.TOML.parse(text)));
  const project = yield* readJson(ProjectPackage, join(packageDirectory, "package.json"));
  const declared = { ...project.dependencies, ...project.devDependencies };
  const installed = (name: string) =>
    readJson(InstalledPackage, join(packageDirectory, "node_modules", name, "package.json")).pipe(Effect.map(({ version }) => version));
  const checks: readonly (readonly [string, string | undefined, string])[] = [
    ["running Bun", Bun.version, lock.bun],
    ["packageManager", project.packageManager, `bun@${lock.bun}`],
    ["declared typescript", declared["typescript"], lock.typescriptCompilerApi],
    ["installed typescript", yield* installed("typescript"), lock.typescriptCompilerApi],
    ["declared typescript-native", declared["typescript-native"], `npm:typescript@${lock.typescriptChecker}`],
    ["installed typescript-native", yield* installed("typescript-native"), lock.typescriptChecker],
    ["declared typescript-to-lua", declared["typescript-to-lua"], lock.typescriptToLua],
    ["installed typescript-to-lua", yield* installed("typescript-to-lua"), lock.typescriptToLua],
    ["declared effect", declared["effect"], lock.effect],
    ["installed effect", yield* installed("effect"), lock.effect],
    ["declared @effect/tsgo", declared["@effect/tsgo"], lock.effectTsgo],
    ["installed @effect/tsgo", yield* installed("@effect/tsgo"), lock.effectTsgo],
  ];
  const mismatches = checks.filter(([, actual, expected]) => actual !== expected).map(([name, actual, expected]) => `${name} ${actual} (locked ${expected})`);
  if (mismatches.length > 0) return yield* new MapBuildFailure({ operation: "verify TypeScript toolchain lock", path: lockPath, cause: mismatches.join("; ") });
});
