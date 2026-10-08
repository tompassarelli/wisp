// MapBuild: compiling the map bundle, the TypeScript-only map build and the
// script-only rebuild (#35, #36). Every step that writes a map works on a
// staged copy that replaces the old map only when every step passed; child
// processes stop when their step is interrupted.
//
// A map with a private container packages into a copy of it. Without one the
// build packages into a copy of the base. The packager grows full hash tables
// when adding imports, so the source archive's capacity is not an import limit.
// The copy's script, object data, description and header are replaced with
// TypeScript-generated ones; every other base map file and every declared
// import must equal its source. Imports the build does not declare stay
// unverified.
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Console, Context, Effect, Layer, Schema } from "effect";
import { payloadKey } from "../../src/runtime/gameFiles";
import { decodeMapInfo, declareMap, encodeMapInfo, mapConfig, mapHeader, type MapDeclaration } from "../mapInfo";
import { type Bundle, composeScript, typescriptBase } from "../mapScript";
import type { BundledModules } from "../luaBundle";
import { BUNDLE_MODULE } from "../../src/runtime/modules";
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
  /**
   * Compiles the map with a compiler kept warm between calls and returns its
   * modules, as a hot reload sends them; it doesn't read the bundle it wrote.
   */
  readonly compile: Effect.Effect<BundledModules, BuildFailure>;
  /**
   * A map whose project code is only the TypeScript bundle, started from
   * the supplied entry module. Like `rebuild`, it reuses the compiled bundle
   * while that is newer than everything the compile reads.
   */
  readonly build: (options: BuildOptions) => Effect.Effect<void, BuildFailure>;
  /** Replaces only war3map.lua of a map built by `build`. */
  readonly rebuild: (map: string, packager?: string) => Effect.Effect<void, BuildFailure>;
}>()("wisp/MapBuild") {
  /**
   * `sources` replaces files' texts in every compile, by absolute path, as
   * `wisp tune` does (wisp:scripts/compiler.ts); such a compile writes no bundle.
   */
  static layer(project: BuildProject, sources?: () => ReadonlyMap<string, string>) {
    const { configPath, bundlePath, compileInputs } = project;
    return Layer.effect(MapBuild, Effect.gen(function*() {
      const sourceErrors = yield* SourceErrors;
      // The compiler API takes about 0.6 s to load, so it loads on the first compile.
      let compiler: Promise<{ readonly run: ReturnType<CompilerModule["mapCompiler"]>; readonly report: CompilerModule["report"] }> | undefined;
      const warmCompiler = () => (compiler ??= import("../compiler").then(({ mapCompiler, report }) => ({ run: mapCompiler(configPath, sources), report })));
      /** The compiled bundle on disk, its source map kept under its key. */
      const compiled = Effect.gen(function*() {
        const bytes = yield* tryMapPromise("read map bundle", bundlePath, () => Bun.file(bundlePath).bytes());
        const bundleChecksum = bytesChecksum(bytes);
        const key = payloadKey(bundleChecksum);
        yield* sourceErrors.retain(bundlePath, key);
        return { text: new TextDecoder().decode(bytes), key, bytes, checksum: bundleChecksum } satisfies CompiledBundle;
      });
      /** A map command times the compiler's loading and phases as steps; `hot` keeps its reload timeline short. */
      const runCompiler = (measured: boolean) => Effect.gen(function*() {
        const load = tryMapPromise("load the map compiler", configPath, warmCompiler);
        const { run, report } = yield* measured ? load.pipe(step("load compiler")) : load;
        const context = yield* Effect.context<never>();
        const phase: Phase = (name, work) => Effect.runSyncWith(context)(Effect.sync(work).pipe(step(name)));
        const diagnostics = yield* tryMapSync("compile map", configPath, () => measured ? run(phase) : run());
        if (diagnostics.length > 0) return yield* new CompileFailure({ diagnostics: report(diagnostics) });
        return run;
      });
      const compileBundle = (measured: boolean) => runCompiler(measured).pipe(Effect.andThen(compiled), step("compile"));
      /** TypeScriptToLua built the bundle, so it reloads as one module. */
      const wholeBundle = Effect.gen(function*() {
        const code = yield* tryMapPromise("read map bundle", bundlePath, () => Bun.file(bundlePath).text());
        const map = yield* tryMapPromise("read map bundle source map", `${bundlePath}.map`, () => Bun.file(`${bundlePath}.map`).text());
        // MODULE_HEAD puts one line before the bundle's first.
        const sourceMap = () => map.replace(/"mappings":"/, "\"mappings\":\";");
        return { entry: BUNDLE_MODULE, modules: [{ name: BUNDLE_MODULE, code, sourceMap }] } satisfies BundledModules;
      });
      const compile = runCompiler(false).pipe(
        Effect.flatMap((run) => {
          const modules = run.modules();
          if (modules !== undefined) return Effect.succeed(modules);
          // The bundle on disk lacks the replaced texts.
          if (sources !== undefined && sources().size > 0) {
            return Effect.fail(new MapBuildFailure({ operation: "compile replaced sources", path: configPath, cause: "TypeScriptToLua builds this bundle itself (sourceMapTraceback)" }));
          }
          return wholeBundle;
        }),
        step("compile"),
      );
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
  const entries = list.split(/\r?\n/).filter((entry) => entry.length > 0 && !generated.has(entry))
    .map((entry, index): ArchiveEntry => ({ entry, source: join(work, `base-${index}`) }));
  yield* mapPack(packager).extractAll(base, entries, join(work, "base-entries"));
  return entries;
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
  const lua = join(dirname(packager), "lua");
  yield* ensureLua(lua);
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
    yield* runProcess("check map script syntax", scriptPath, [join(lua, "bin/luac"), "-p", scriptPath]).pipe(step("check script syntax"));
    const assets = [
      ...yield* baseMapFiles(packager, options.base, new Set(files.map(({ entry }) => entry)), work).pipe(step("extract base files")),
      ...options.imports ?? [],
    ];
    return { generated, files, assets };
  }).pipe(step("generate"));

  yield* stageMap(options.container ?? options.base, out, (staged) => Effect.gen(function*() {
    yield* Effect.gen(function*() {
      yield* packageEntries((entries) => pack.replaceAll(staged, entries, join(work, "package-entries")), assets, files);
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

/**
 * The map packager at `path`; when it is missing or was compiled from other
 * source (its `.source-sha256` stamp), compiles wisp:native/map-pack.c there
 * against nixpkgs StormLib, or the StormLib installed under `STORMLIB_PREFIX`
 * with the compiler `CC` when they are set (CI runners have no nix). Each
 * compile writes its own file and renames it in.
 */
export const ensurePackager = (path: string) => Effect.suspend(() => {
  const source = new Bun.CryptoHasher("sha256").update(readFileSync(PACKAGER_SOURCE)).digest("hex");
  const stamp = `${path}.source-sha256`;
  const current = existsSync(path) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === source;
  return current ? Effect.void : compilePackager(path, source, stamp);
});

const compilePackager = (path: string, source: string, stamp: string) => Effect.gen(function*() {
  const stormlib = process.env.STORMLIB_PREFIX ?? (yield* captureProcess("build StormLib", path, ["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#stormlib"]).pipe(
    Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0
      ? Effect.succeed(stdout.trim().split("\n")[0] ?? "")
      : Effect.fail(new MapBuildFailure({ operation: "build StormLib", path, cause: `nix exited with ${exitCode}: ${stderr.trim()}` }))),
  ));
  const compiler = process.env.CC === undefined ? ["nix", "shell", "nixpkgs#gcc", "--command", "gcc"] : [process.env.CC];
  yield* tryMapSync("create packager directory", path, () => mkdirSync(dirname(path), { recursive: true }));
  yield* runProcess("compile map packager", path, [...compiler, `-I${stormlib}/include`, PACKAGER_SOURCE,
    `-L${stormlib}/lib`, `-Wl,-rpath,${stormlib}/lib`, "-lstorm", "-o", `${path}.${process.pid}.next`]);
  yield* tryMapSync("install map packager", path, () => {
    renameSync(`${path}.${process.pid}.next`, path);
    writeFileSync(`${stamp}.${process.pid}.next`, `${source}\n`);
    renameSync(`${stamp}.${process.pid}.next`, stamp);
  });
}).pipe(step("compile map packager"));

/** The Lua 5.3 compiler's package at `directory`; when it is missing, links nixpkgs' lua5_3 there, which keeps it from garbage collection so later builds need no nix. */
export const ensureLua = (directory: string) => Effect.suspend(() => existsSync(join(directory, "bin/luac")) ? Effect.void : Effect.gen(function*() {
  yield* tryMapSync("create Lua directory", directory, () => mkdirSync(dirname(directory), { recursive: true }));
  yield* runProcess("link Lua compiler", directory, ["nix", "build", "--out-link", directory, "nixpkgs#lua5_3"]);
}).pipe(step("link Lua compiler")));

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

/** One FILE<TAB>ARCHIVE_NAME line per entry, the packager's list format. */
const entryList = (entries: readonly ArchiveEntry[]) => entries.map(({ entry, source }) => {
  if (/[\t\r\n]/.test(entry + source)) throw new Error(`${entry} or its file ${source} holds a tab or line break`);
  return `${source}\t${entry}\n`;
}).join("");

const writeEntryList = (path: string, entries: readonly ArchiveEntry[]) =>
  tryMapSync("write entry list", path, () => writeFileSync(path, entryList(entries)));

/**
 * The supplied map packager: extracts or replaces one archive entry,
 * war3map.lua by default, or every entry of a list in one archive opening.
 * Each entry is stored zlib-compressed, byte for byte: nothing is re-encoded.
 */
function mapPack(packager: string) {
  return {
    /** Later entries win, as separate replaces would. */
    replaceAll: (archive: string, entries: readonly ArchiveEntry[], list: string) =>
      writeEntryList(list, entries).pipe(Effect.andThen(runProcess(`replace ${entries.length} entries`, archive, [packager, "replace-list", archive, list]))),
    /** Writes each entry to its `source`. */
    extractAll: (archive: string, entries: readonly ArchiveEntry[], list: string) =>
      writeEntryList(list, entries).pipe(Effect.andThen(runProcess(`extract ${entries.length} entries`, archive, [packager, "extract-list", archive, list]))),
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
 * Copies `source` to a staged copy of this process's own, lets `edit`
 * change and verify the copy, then renames it over `destination`. A failed
 * or interrupted edit removes the copy and leaves `destination` as it was;
 * concurrent builds of one destination never share a staged file. The copy is
 * writable even when `source` is a read-only stored input.
 */
export const stageMap = <E>(source: string, destination: string, edit: (staged: string) => Effect.Effect<void, E>) =>
  Effect.acquireUseRelease(
    tryMapSync("stage map", destination, () => {
      const staged = `${destination}.${process.pid}.next`;
      copyFileSync(source, staged);
      chmodSync(staged, 0o644);
      return staged;
    }),
    (staged) => edit(staged).pipe(Effect.andThen(tryMapSync("publish map", destination, () => renameSync(staged, destination)))),
    (staged) => Effect.sync(() => rmSync(staged, { force: true })),
  );

export interface ArchiveEntry {
  readonly entry: string;
  /** The file whose bytes the archive entry must equal. */
  readonly source: string;
}

/** Add base assets and declared imports before generated files, so generated entries win collisions. */
export const packageEntries = (
  replaceAll: (entries: readonly ArchiveEntry[]) => Effect.Effect<void, BuildFailure>,
  assets: readonly ArchiveEntry[],
  files: readonly ArchiveEntry[],
) => replaceAll([...assets, ...files]);

/** Extracts every entry in one archive opening, then compares each with its source file, four at a time. */
const verifyArchive = (packager: string, archive: string, entries: readonly ArchiveEntry[], scratch: string) => Effect.gen(function*() {
  const extracted = entries.map(({ entry }, index): ArchiveEntry => ({ entry, source: join(scratch, `verify-${index}`) }));
  yield* mapPack(packager).extractAll(archive, extracted, join(scratch, "verify-entries"));
  yield* Effect.forEach(entries, ({ entry, source }, index) => Effect.gen(function*() {
    const extracted = join(scratch, `verify-${index}`);
    const [actual, expected] = yield* tryMapPromise("compare archive entry", entry, () =>
      Promise.all([Bun.file(extracted).bytes(), Bun.file(source).bytes()]));
    if (Buffer.compare(actual, expected) !== 0) return yield* new MapBuildFailure({ operation: "compare archive entry", path: entry, cause: `differs from ${source}` });
  }), { concurrency: 4, discard: true });
});

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
