import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { Console, Context, Effect, Layer, Schema } from "effect";
import { payloadKey } from "../../src/runtime/gameFiles";
import { decodeMapInfo, declareMap, encodeMapInfo, mapConfig, mapHeader, type MapDeclaration } from "../toolchain/mapInfo";
import { type Bundle, composeScript, typescriptBase } from "../toolchain/mapScript";
import type { BundledModules } from "../toolchain/luaBundle";
import { BUNDLE_MODULE } from "../../src/runtime/modules";
import { abilityData } from "../toolchain/objectData";
import { bytesChecksum } from "../io/preloadRecord";
import { writeAtomic } from "../io/files";
import { MapBuildFailure, runProcess, stageMap, tryMapPromise, tryMapSync, captureProcess } from "../cli/hostProcess";
import type { Phase } from "../toolchain/compiler";
import { type SourceMapFailure, SourceErrors } from "./sourceErrors";
import { step } from "../cli/timings";
import { checkUnitModels, type UnitModels, type ModelSource } from "../models/unitModels";
import { lua32Key } from "./lua32";
import { installWindowsTool, usesWindowsTools } from "./windowsTools";

export { MapBuildFailure };

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

export class CompileFailure extends Schema.TaggedError<CompileFailure>()("CompileFailure", {
  diagnostics: Schema.String,
}) {
  override get message(): string {
    return this.diagnostics;
  }
}

interface CompiledBundle extends Bundle {
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

export interface GeneratedFile {
  readonly entry: string;
  readonly contents: Uint8Array;
}

export interface BuildOptions {
  readonly base: string;

  readonly container?: string;
  readonly name: string;
  readonly out: string;
  readonly packager?: string;
  readonly declaration: MapDeclaration;

  readonly objectData?: readonly GeneratedFile[];
  readonly imports?: readonly ArchiveEntry[];

  readonly unitModels?: UnitModels;

  readonly localModels?: readonly ModelSource[];
}

export type BuildFailure = MapBuildFailure | CompileFailure | SourceMapFailure;
type CompilerModule = typeof import("../toolchain/compiler");

const compileCacheDirectory = () => process.env.WISP_COMPILE_CACHE || join(homedir(), ".cache/wisp/compile");

export class MapBuild extends Context.Service<MapBuild, {

  readonly compile: Effect.Effect<BundledModules, BuildFailure>;

  readonly build: (options: BuildOptions) => Effect.Effect<void, BuildFailure>;

  readonly rebuild: (map: string, packager?: string) => Effect.Effect<void, BuildFailure>;
}>()("wisp/MapBuild") {

  static layer(project: BuildProject, sources?: () => ReadonlyMap<string, string>) {
    const { configPath, bundlePath, compileInputs } = project;
    return Layer.effect(MapBuild, Effect.gen(function*() {
      const sourceErrors = yield* SourceErrors;

      let compiler: Promise<{ readonly run: ReturnType<CompilerModule["mapCompiler"]>; readonly report: CompilerModule["report"]; readonly reportHandleWarnings: CompilerModule["reportHandleWarnings"] }> | undefined;
      const warmCompiler = () => (compiler ??= import("../toolchain/compiler").then(({ mapCompiler, report, reportHandleWarnings }) => ({ run: mapCompiler(configPath, sources, compileCacheDirectory()), report, reportHandleWarnings })));

      const compiled = Effect.gen(function*() {
        const bytes = yield* tryMapPromise("read map bundle", bundlePath, () => Bun.file(bundlePath).bytes());
        const bundleChecksum = bytesChecksum(bytes);
        const key = payloadKey(bundleChecksum);
        yield* sourceErrors.retain(bundlePath, key);
        return { text: new TextDecoder().decode(bytes), key, bytes, checksum: bundleChecksum } satisfies CompiledBundle;
      });

      const runCompiler = (measured: boolean) => Effect.gen(function*() {
        const load = tryMapPromise("load the map compiler", configPath, warmCompiler);
        const { run, report, reportHandleWarnings } = yield* measured ? load.pipe(step("load compiler")) : load;
        const context = yield* Effect.context<never>();
        const phase: Phase = (name, work) => Effect.runSyncWith(context)(Effect.sync(work).pipe(step(name)));
        const diagnostics = yield* tryMapSync("compile map", configPath, () => measured ? run(phase) : run());
        if (run.warnings().length > 0) yield* Console.warn(reportHandleWarnings(run.warnings()));
        if (diagnostics.length > 0) return yield* new CompileFailure({ diagnostics: report(diagnostics) });
        return run;
      });
      const compileBundle = (measured: boolean) => runCompiler(measured).pipe(Effect.andThen(compiled), step("compile"));

      const wholeBundle = Effect.gen(function*() {
        const code = yield* tryMapPromise("read map bundle", bundlePath, () => Bun.file(bundlePath).text());
        const map = yield* tryMapPromise("read map bundle source map", `${bundlePath}.map`, () => Bun.file(`${bundlePath}.map`).text());

        const sourceMap = () => map.replace(/"mappings":"/, "\"mappings\":\";");
        return { entry: BUNDLE_MODULE, modules: [{ name: BUNDLE_MODULE, code, sourceMap }] } satisfies BundledModules;
      });
      const compile = runCompiler(false).pipe(
        Effect.flatMap((run) => {
          const modules = run.modules();
          if (modules !== undefined) return Effect.succeed(modules);

          if (sources !== undefined && sources().size > 0) {
            return Effect.fail(new MapBuildFailure({ operation: "compile replaced sources", path: configPath, cause: "TypeScriptToLua builds this bundle itself (sourceMapTraceback)" }));
          }
          return wholeBundle;
        }),
        step("compile"),
      );

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

function newestModification(path: string): number {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return readdirSync(path).reduce((newest, name) => Math.max(newest, newestModification(join(path, name))), 0);
}

function freshBundleAge(bundle: string, inputs: readonly string[], now: number): number | undefined {
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

export const baseMapEntryNames = (list: string, replacements: readonly ArchiveEntry[]) => {
  const replaced = new Set(replacements.map(({ entry }) => entry.toLowerCase()));
  return list.split(/\r?\n/).filter((entry) => entry.length > 0 && !replaced.has(entry.toLowerCase()));
};

const baseMapFiles = (packager: string, base: string, replacements: readonly ArchiveEntry[], work: string) => Effect.gen(function*() {
  const listPath = join(work, "base-listfile");
  yield* mapPack(packager).extract(base, listPath, "(listfile)");
  const list = yield* tryMapPromise("read base map file list", base, () => Bun.file(listPath).text());
  const entries = baseMapEntryNames(list, replacements)
    .map((entry, index): ArchiveEntry => ({ entry, source: join(work, `base-${index}`) }));
  yield* mapPack(packager).extractAll(base, entries, join(work, "base-entries"));
  return entries;
});

const writeHeader = (map: string, header: Uint8Array) => tryMapSync("write map header", map, () => {
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
      ...yield* baseMapFiles(packager, options.base, [...files, ...options.imports ?? []], work).pipe(step("extract base files")),
      ...options.imports ?? [],
    ];
    if (options.unitModels !== undefined) {
      yield* checkUnitModels(options.unitModels, [...options.localModels ?? [], ...assets, ...files]).pipe(
        Effect.mapError((cause) => new MapBuildFailure({ operation: "check unit models", path: out, cause: cause.message })),
        step("check unit models"),
      );
    }
    return { generated, files, assets };
  }).pipe(step("generate"));

  const archive = yield* assetArchive(packager, options.container ?? options.base, assets, work).pipe(step("asset archive"));
  yield* stageMap(archive, out, (staged) => Effect.gen(function*() {
    yield* Effect.gen(function*() {
      yield* pack.replaceAll(staged, files, join(work, "package-entries"));
      yield* writeHeader(staged, generated.header);
    }).pipe(step("package"));
    yield* Effect.gen(function*() {
      const header = yield* tryMapPromise("read map header", staged, () => Bun.file(staged).slice(0, generated.header.length).bytes());
      if (Buffer.compare(header, generated.header) !== 0) {
        return yield* new MapBuildFailure({ operation: "verify map header", path: staged, cause: "header differs from the generated one" });
      }
      yield* verifyArchive(packager, staged, files, work);
      yield* verifyListed(packager, staged, assets, work);
    }).pipe(step(`verify ${files.length} entries, ${assets.length} listed`));
  }));
  yield* tryMapPromise("keep base script for rebuilds", `${out}.base.lua`, () => Bun.write(`${out}.base.lua`, generated.base));
  yield* Console.log(`built ${out}`);
}));

function withFileIo(objectData: readonly GeneratedFile[] = []): readonly GeneratedFile[] {
  return objectData.some(({ entry }) => entry === "war3map.w3a") ? objectData : [...objectData, { entry: "war3map.w3a", contents: abilityData() }];
}

const PACKAGER_SOURCE = join(import.meta.dir, "../../native/map-pack.c");

export const packagerSource = () => new Bun.CryptoHasher("sha256").update(readFileSync(PACKAGER_SOURCE)).digest("hex");

export const ensurePackager = (path: string) => Effect.suspend(() => {
  const source = packagerSource();
  if (usesWindowsTools()) return installWindowsTool("map-pack.exe", source, `${path}.exe`);
  const stamp = `${path}.source-sha256`;
  const stormlibRooted = process.env.STORMLIB_PREFIX !== undefined || existsSync(stormlibGcRoot(path));
  const current = stormlibRooted && existsSync(path) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === source;
  return current ? Effect.void : compilePackager(path, source, stamp);
});

const stormlibGcRoot = (packager: string) => `${packager}.stormlib-gc-root`;

const compilePackager = (path: string, source: string, stamp: string) => Effect.gen(function*() {
  yield* tryMapSync("create packager directory", path, () => mkdirSync(dirname(path), { recursive: true }));
  const stormlib = process.env.STORMLIB_PREFIX ?? (yield* captureProcess("build StormLib", path, ["nix", "build", "--out-link", stormlibGcRoot(path), "--print-out-paths", "nixpkgs#stormlib"]).pipe(
    Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0
      ? Effect.succeed(stdout.trim().split("\n")[0] ?? "")
      : Effect.fail(new MapBuildFailure({ operation: "build StormLib", path, cause: `nix exited with ${exitCode}: ${stderr.trim()}` }))),
  ));
  const compiler = process.env.CC === undefined ? ["nix", "shell", "nixpkgs#gcc", "--command", "gcc"] : [process.env.CC];
  yield* runProcess("compile map packager", path, [...compiler, `-I${stormlib}/include`, PACKAGER_SOURCE,
    `-L${stormlib}/lib`, `-Wl,-rpath,${stormlib}/lib`, "-lstorm", "-o", `${path}.${process.pid}.next`]);
  yield* tryMapSync("install map packager", path, () => {
    renameSync(`${path}.${process.pid}.next`, path);
    writeAtomic(stamp, `${source}\n`);
  });
}).pipe(step("compile map packager"));

const ensureLua = (directory: string) => usesWindowsTools()
  ? Effect.suspend(() => installWindowsTool("luac.exe", lua32Key("stock"), join(directory, "bin/luac.exe")))
  : Effect.suspend(() => existsSync(join(directory, "bin/luac")) ? Effect.void : Effect.gen(function*() {
  yield* tryMapSync("create Lua directory", directory, () => mkdirSync(dirname(directory), { recursive: true }));
  yield* runProcess("link Lua compiler", directory, ["nix", "build", "--out-link", directory, "nixpkgs#lua5_3"]);
}).pipe(step("link Lua compiler")));

/** One FILE<TAB>ARCHIVE_NAME line per entry, the packager's list format. */
const entryList = (entries: readonly ArchiveEntry[]) => entries.map(({ entry, source }) => {
  if (/[\t\r\n]/.test(entry + source)) throw new Error(`${entry} or its file ${source} holds a tab or line break`);
  return `${source}\t${entry}\n`;
}).join("");

const writeEntryList = (path: string, entries: readonly ArchiveEntry[]) =>
  tryMapSync("write entry list", path, () => writeFileSync(path, entryList(entries)));

export function mapPack(packager: string) {
  return {

    replaceAll: (archive: string, entries: readonly ArchiveEntry[], list: string) =>
      writeEntryList(list, entries).pipe(Effect.andThen(runProcess(`replace ${entries.length} entries`, archive, [packager, "replace-list", archive, list]))),

    extractAll: (archive: string, entries: readonly ArchiveEntry[], list: string) =>
      writeEntryList(list, entries).pipe(Effect.andThen(runProcess(`extract ${entries.length} entries`, archive, [packager, "extract-list", archive, list]))),
    extract: (archive: string, file: string, entry = "war3map.lua") =>
      runProcess(`extract ${entry}`, archive, [packager, "extract", archive, file, entry]),
    replace: (archive: string, file: string, entry = "war3map.lua") =>
      runProcess(`replace ${entry}`, archive, [packager, "replace", archive, file, entry]),
    create: (archive: string, entries: readonly ArchiveEntry[], list: string) =>
      writeEntryList(list, entries).pipe(Effect.andThen(runProcess(`create ${archive} with ${entries.length} entries`, archive, [packager, "create", archive, list]))),
  };
}

const workDirectory = (parent: string) =>
  Effect.acquireRelease(
    tryMapSync("create work directory", parent, () => mkdtempSync(join(parent, "ts-map."))),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );

export interface ArchiveEntry {
  readonly entry: string;

  readonly source: string;
}

export const assetArchiveKey = (container: string, assets: readonly ArchiveEntry[]) => {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(readFileSync(container));
  for (const { entry, source } of assets) hash.update(`\0${entry}\0`).update(readFileSync(source));
  return hash.digest("hex");
};

const ASSET_ARCHIVES_KEPT = 3;

const assetArchive = (packager: string, container: string, assets: readonly ArchiveEntry[], work: string) => Effect.gen(function*() {
  const directory = join(compileCacheDirectory(), "archives");
  const key = yield* tryMapSync("hash map assets", container, () => assetArchiveKey(container, assets));
  const archive = join(directory, `${key}.w3x`);
  if (existsSync(archive)) {
    yield* tryMapSync("touch asset archive", archive, () => utimesSync(archive, new Date(), new Date()));
    return archive;
  }
  yield* tryMapSync("create asset archive directory", directory, () => mkdirSync(directory, { recursive: true }));
  yield* stageMap(container, archive, (staged) => mapPack(packager).replaceAll(staged, assets, join(work, "asset-entries")).pipe(
    Effect.andThen(verifyArchive(packager, staged, assets, work)),
  ));
  yield* tryMapSync("prune asset archives", directory, () => {
    const kept = readdirSync(directory).filter((name) => name.endsWith(".w3x")).map((name) => join(directory, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    for (const old of kept.slice(ASSET_ARCHIVES_KEPT)) rmSync(old, { force: true });
  });
  return archive;
});

const verifyListed = (packager: string, archive: string, entries: readonly ArchiveEntry[], scratch: string) => Effect.gen(function*() {
  const listPath = join(scratch, "verify-listfile");
  yield* mapPack(packager).extract(archive, listPath, "(listfile)");
  const listed = new Set((yield* tryMapPromise("read archive file list", archive, () => Bun.file(listPath).text())).split(/\r?\n/).map((name) => name.toLowerCase()));
  const missing = entries.filter(({ entry }) => !listed.has(entry.toLowerCase()));
  if (missing.length > 0) return yield* new MapBuildFailure({ operation: "verify archive entries", path: archive, cause: `missing ${missing.slice(0, 3).map(({ entry }) => entry).join(", ")}` });
});

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

const verifyToolchain = (lockPath: string, packageDirectory: string) => Effect.gen(function*() {
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
