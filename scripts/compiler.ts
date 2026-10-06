// A map compiler that stays warm between compiles. TypeScript's builder
// program works out which files an edit affects (the edited files, and their
// dependents when an exported declaration changed); only those are type-checked
// and transformed to Lua again. Every other module's Lua comes from the previous
// compile, and the bundle is rebuilt from all modules in program order, so the
// output equals a full compile's. The bundle reuses each unchanged module's
// resolved requires, text and source-map mappings (wisp:scripts/luaBundle.ts),
// and keeps each module's code and map for hot reloads by module.
import { statSync } from "node:fs";
import { normalize, resolve } from "node:path";
import ts from "typescript";
import type { SourceNode } from "source-map";
import { type CompilerOptions, Transpiler, parseConfigFileWithSystem } from "typescript-to-lua";
import { LuaLibImportKind, LuaTarget, isBundleEnabled } from "typescript-to-lua/dist/CompilerOptions";
import { buildMinimalLualibBundle, findUsedLualibFeatures, getLuaLibBundle } from "typescript-to-lua/dist/LuaLib";
import { getBundleResult } from "typescript-to-lua/dist/transpilation/bundle";
import type { Plugin } from "typescript-to-lua/dist/transpilation/plugins";
import { getPlugins } from "typescript-to-lua/dist/transpilation/plugins";
import { resolveDependencies } from "typescript-to-lua/dist/transpilation/resolve";
import { getSourceDir } from "typescript-to-lua/dist/transpilation/transpiler";
import { getProgramTranspileResult } from "typescript-to-lua/dist/transpilation/transpile";
import type { EmitFile, ProcessedFile } from "typescript-to-lua/dist/transpilation/utils";
import { normalizeSlashes } from "typescript-to-lua/dist/utils";
import { type BundledModules, LuaBundler } from "./luaBundle";

/** Runs one named phase of a compile and returns its result; a caller times the phase by supplying one. */
export type Phase = <A>(name: string, run: () => A) => A;

/** With COMPILER_TIMINGS set, an unsupplied hook prints each phase's duration. */
const defaultPhase: Phase = (name, run) => {
  if (process.env.COMPILER_TIMINGS === undefined) return run();
  const started = performance.now();
  try {
    return run();
  } finally {
    console.log(`compile ${name} ${(performance.now() - started).toFixed(1)} ms`);
  }
};

interface CachedModule {
  readonly file: ProcessedFile;
  readonly sourceMapChildren: readonly { readonly node: SourceNode; readonly children: SourceNode[] }[];
}

/** TSTL 1.37.1 rewrites requires by replacing a source-map node's children. */
function cacheModule(file: ProcessedFile): CachedModule {
  const sourceMapChildren: { readonly node: SourceNode; readonly children: SourceNode[] }[] = [];
  function visit(node: SourceNode): void {
    sourceMapChildren.push({ node, children: node.children });
    for (const child of node.children) if (typeof child !== "string") visit(child);
  }
  if (file.sourceMapNode !== undefined) visit(file.sourceMapNode);
  return { file, sourceMapChildren };
}

interface Resolution {
  readonly source: string;
  readonly node: ProcessedFile["sourceMapNode"];
  readonly code: string;
  /** Lua files outside the program it pulled in, resolved. */
  readonly dependencies: readonly ProcessedFile[];
}

class IncrementalTranspiler extends Transpiler {
  /** Preserve each module as first printed; emission copies code and restores tree rewrites. */
  private readonly modules = new Map<string, CachedModule>();
  private readonly bundler = new LuaBundler();
  /** Each module's resolved requires, while its transpiled code and tree are unchanged. */
  private readonly resolutions = new Map<string, Resolution>();
  private resolvedProgramFiles = "";

  /** The modules of the last bundle; undefined when TypeScriptToLua built it. */
  get bundled(): BundledModules | undefined {
    return this.bundler.bundled;
  }

  /** TSTL 1.37.1's emit plan for a bundle, built by the caching bundler when it can. */
  protected override getEmitPlan(program: ts.Program, diagnostics: ts.Diagnostic[], files: ProcessedFile[], plugins: Plugin[]): { emitPlan: EmitFile[] } {
    const options: CompilerOptions = program.getCompilerOptions();
    if (!isBundleEnabled(options)) return super.getEmitPlan(program, diagnostics, files, plugins);
    // An unchanged module's resolved code is reused only for the caching bundler, which never walks its tree
    // again; TypeScriptToLua's own bundle reads every module's tree.
    const cached = !options.sourceMapTraceback;
    const withLualib = (resolved: ProcessedFile[]) => {
      if (!resolved.some((file) => file.fileName === "lualib_bundle")) return resolved;
      const modules = resolved.filter((file) => file.fileName !== "lualib_bundle");
      const luaTarget = options.luaTarget ?? LuaTarget.Universal;
      const code = options.luaLibImport === LuaLibImportKind.RequireMinimal
        ? buildMinimalLualibBundle(findUsedLualibFeatures(luaTarget, this.emitHost, modules.map((file) => file.code)), luaTarget, this.emitHost)
        : getLuaLibBundle(luaTarget, this.emitHost);
      return [{ fileName: normalizeSlashes(resolve(getSourceDir(program), "lualib_bundle.lua")), code }, ...modules];
    };
    const fullResolution = () => {
      const resolution = resolveDependencies(program, files.map((file) => ({ ...file, code: this.modules.get(file.fileName)?.file.code ?? file.code })), this.emitHost, plugins);
      return { resolved: withLualib(resolution.resolvedFiles), diagnostics: resolution.diagnostics };
    };
    if (cached) {
      const changed = this.resolveChanged(program, files, plugins);
      diagnostics.push(...changed.diagnostics);
      const built = this.bundler.bundle(program, withLualib(changed.resolved));
      if (built !== undefined) {
        diagnostics.push(...built[0]);
        return { emitPlan: [built[1]] };
      }
    }
    // TypeScriptToLua builds the bundle from every module's tree, so each needs its requires resolved.
    const full = fullResolution();
    if (!cached) diagnostics.push(...full.diagnostics);
    const [bundleDiagnostics, bundle] = getBundleResult(program, full.resolved);
    diagnostics.push(...bundleDiagnostics);
    return { emitPlan: [bundle] };
  }

  /**
   * Resolves the requires of each module that changed since the last compile,
   * as resolveDependencies would resolve them all: each module, then the Lua
   * files outside the program it first pulls in. An unchanged module takes the
   * code it resolved to before. A change to the program's files resolves every
   * module again.
   */
  private resolveChanged(program: ts.Program, files: ProcessedFile[], plugins: Plugin[]): { resolved: ProcessedFile[]; diagnostics: ts.Diagnostic[] } {
    const programFiles = program.getSourceFiles().map((file) => file.fileName).join("\n");
    if (programFiles !== this.resolvedProgramFiles) {
      this.resolutions.clear();
      this.resolvedProgramFiles = programFiles;
    }
    const resolved: ProcessedFile[] = [];
    const diagnostics: ts.Diagnostic[] = [];
    const added = new Set<string>();
    const add = (file: ProcessedFile) => {
      if (added.has(file.fileName)) return;
      added.add(file.fileName);
      resolved.push(file);
    };
    const live = new Set<string>();
    for (const file of files) {
      live.add(file.fileName);
      let resolution = this.resolutions.get(file.fileName);
      if (resolution === undefined || resolution.source !== file.code || resolution.node !== file.sourceMapNode) {
        const source = file.code;
        const result = resolveDependencies(program, [file], this.emitHost, plugins);
        diagnostics.push(...result.diagnostics);
        resolution = { source, node: file.sourceMapNode, code: file.code, dependencies: result.resolvedFiles.slice(1) };
        if (result.diagnostics.length === 0) this.resolutions.set(file.fileName, resolution);
        else this.resolutions.delete(file.fileName);
      } else {
        file.code = resolution.code;
      }
      add(file);
      for (const dependency of resolution.dependencies) add(dependency);
    }
    for (const name of this.resolutions.keys()) if (!live.has(name)) this.resolutions.delete(name);
    return { resolved, diagnostics };
  }

  /** With `write` false nothing is written; the modules stay in memory for a hot reload. */
  compile(program: ts.Program, affected: readonly ts.SourceFile[], phase: Phase, write: boolean): readonly ts.Diagnostic[] {
    const writeFile: ts.WriteFileCallback = write ? this.emitHost.writeFile : () => {};
    const transpiled = phase("transpile", () => {
      const { diagnostics: pluginDiagnostics, plugins } = getPlugins(program);
      if (pluginDiagnostics.length > 0) return { diagnostics: pluginDiagnostics, plugins, transpiledFiles: [] };
      return { plugins, ...getProgramTranspileResult(this.emitHost, writeFile, { program, plugins, sourceFiles: [...affected] }) };
    });
    if (transpiled.diagnostics.length > 0) return transpiled.diagnostics;
    return phase("bundle", () => {
      for (const file of transpiled.transpiledFiles) this.modules.set(file.fileName, cacheModule(file));
      const ordered: ProcessedFile[] = [];
      const live = new Set<string>();
      for (const source of program.getSourceFiles()) {
        const name = normalize(source.fileName);
        live.add(name);
        const module = this.modules.get(name);
        if (module !== undefined) ordered.push({ ...module.file });
      }
      for (const name of this.modules.keys()) if (!live.has(name)) this.modules.delete(name);
      const planDiagnostics: ts.Diagnostic[] = [];
      let plan: ReturnType<IncrementalTranspiler["getEmitPlan"]>;
      try {
        plan = this.getEmitPlan(program, planDiagnostics, ordered, transpiled.plugins);
      } finally {
        // Bundling is synchronous and has finished reading these trees. Restore
        // the original requires before the next emission reuses unchanged modules.
        for (const module of this.modules.values()) {
          for (const { node, children } of module.sourceMapChildren) node.children = children;
        }
      }
      const { emitPlan } = plan;
      if (planDiagnostics.length > 0) return planDiagnostics;
      const { sourceMap: writeSourceMap = false, emitBOM = false } = program.getCompilerOptions();
      for (const { outputPath, code, sourceMap, sourceFiles } of emitPlan) {
        writeFile(outputPath, code, emitBOM, undefined, sourceFiles);
        if (writeSourceMap && sourceMap !== undefined) writeFile(`${outputPath}.map`, sourceMap, emitBOM, undefined, sourceFiles);
      }
      return [];
    });
  }
}

interface CachedSource {
  readonly stamp: string;
  readonly file: ts.SourceFile;
}

/**
 * A compiler host that parses a file again only when its size or modification
 * time changed, or the text replacing it did.
 */
function cachingHost(options: ts.CompilerOptions, cache: Map<string, CachedSource>, replaced: ReadonlyMap<string, string>): ts.CompilerHost {
  const host = ts.createIncrementalCompilerHost(options);
  const parse = host.getSourceFile.bind(host);
  if (replaced.size > 0) {
    const readFile = host.readFile.bind(host);
    host.readFile = (fileName) => replaced.get(normalize(fileName)) ?? readFile(fileName);
  }
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const replacement = replaced.get(normalize(fileName));
    const stat = replacement === undefined ? statSync(fileName, { throwIfNoEntry: false }) : undefined;
    const stamp = replacement !== undefined ? `text:${replacement}` : stat === undefined ? "missing" : `${stat.mtimeMs}:${stat.size}`;
    const cached = cache.get(fileName);
    if (cached?.stamp === stamp && shouldCreateNewSourceFile !== true) return cached.file;
    const file = parse(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    if (file !== undefined) cache.set(fileName, { stamp, file });
    return file;
  };
  return host;
}

export interface MapCompiler {
  (phase?: Phase): readonly ts.Diagnostic[];
  /** The modules of the last successful compile's bundle; undefined when TypeScriptToLua built it. */
  readonly modules: () => BundledModules | undefined;
}

const noReplacements = (): ReadonlyMap<string, string> => new Map();

/**
 * `sources` returns, before each compile, texts that replace files' contents,
 * by absolute path, such as `wisp tune`'s values. A compile that replaces a
 * file writes nothing, so the bundle on disk is always compiled from the files.
 */
export function mapCompiler(configPath: string, sources: () => ReadonlyMap<string, string> = noReplacements): MapCompiler {
  // An absolute config path keeps every source file name absolute, which the
  // map plugin needs to recognize f32, floorDiv and floorMod by their file.
  const absolute = resolve(configPath);
  const transpiler = new IncrementalTranspiler();
  const parsed = new Map<string, CachedSource>();
  let builder: ts.EmitAndSemanticDiagnosticsBuilderProgram | undefined;
  let signaturesPrimed = false;
  const compile = (phase: Phase = defaultPhase): readonly ts.Diagnostic[] => {
    // Parsed every time so added and removed files are picked up.
    const config = phase("read config", () => parseConfigFileWithSystem(absolute));
    if (config.errors.length > 0) return config.errors;
    config.options.declaration = true;
    const replaced = sources();
    const host = cachingHost(config.options, parsed, replaced);
    const current = phase("create program", () => ts.createEmitAndSemanticDiagnosticsBuilderProgram(config.fileNames, config.options, host, builder));
    builder = current;
    const program = current.getProgram();
    const global = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (global.length > 0) return global;
    const { affected, diagnostics } = phase("type-check", () => {
      const affected: ts.SourceFile[] = [];
      const diagnostics: ts.Diagnostic[] = [];
      for (let next = current.getSemanticDiagnosticsOfNextAffectedFile(); next !== undefined; next = current.getSemanticDiagnosticsOfNextAffectedFile()) {
        // A whole-program result (after an options change) means every file is affected.
        const files = "fileName" in next.affected ? [next.affected] : next.affected.getSourceFiles();
        for (const file of files) {
          if (file.isDeclarationFile) continue;
          affected.push(file);
          diagnostics.push(...program.getSyntacticDiagnostics(file));
        }
        diagnostics.push(...next.result);
      }
      return { affected, diagnostics };
    });
    if (!signaturesPrimed) {
      phase("declaration signatures", () => {
        const declarations = current.emit(undefined, () => {}, undefined, true);
        diagnostics.push(...declarations.diagnostics);
        signaturesPrimed = declarations.diagnostics.length === 0 && diagnostics.length === 0;
      });
    }
    if (diagnostics.length > 0) return diagnostics;
    // Both TSTL and TypeScript's emit gate request whole-program declaration
    // diagnostics. Route those through the builder's dependency-aware cache.
    // Its per-file requests still use the program's checker; re-entry also
    // handles an option change that makes the whole program affected.
    const declarationDiagnostics = program.getDeclarationDiagnostics;
    const incrementalDeclarations = current.getDeclarationDiagnostics;
    let checkingDeclarations = false;
    program.getDeclarationDiagnostics = (file, cancellationToken) => {
      if (file !== undefined || checkingDeclarations) return declarationDiagnostics(file, cancellationToken);
      checkingDeclarations = true;
      try {
        return incrementalDeclarations(undefined, cancellationToken);
      } finally {
        checkingDeclarations = false;
      }
    };
    try {
      return transpiler.compile(program, affected, phase, replaced.size === 0);
    } finally {
      program.getDeclarationDiagnostics = declarationDiagnostics;
    }
  };
  return Object.assign(compile, { modules: () => transpiler.bundled });
}

export function report(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}
