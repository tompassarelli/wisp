// A map compiler that stays warm between compiles. TypeScript's builder
// program works out which files an edit affects (the edited files, and their
// dependents when an exported declaration changed); only those are type-checked
// and transformed to Lua again. Every other module's Lua comes from the previous
// compile, and the bundle is rebuilt from all modules in program order, so the
// output equals a full compile's. The bundle reuses each unchanged module's
// text and source-map mappings (wisp:scripts/luaBundle.ts).
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
import { LuaBundler } from "./luaBundle";

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

class IncrementalTranspiler extends Transpiler {
  /** Preserve each module as first printed; emission copies code and restores tree rewrites. */
  private readonly modules = new Map<string, CachedModule>();
  private readonly bundler = new LuaBundler();

  /** TSTL 1.37.1's emit plan for a bundle, built by the caching bundler when it can. */
  protected override getEmitPlan(program: ts.Program, diagnostics: ts.Diagnostic[], files: ProcessedFile[], plugins: Plugin[]): { emitPlan: EmitFile[] } {
    const options: CompilerOptions = program.getCompilerOptions();
    if (!isBundleEnabled(options)) return super.getEmitPlan(program, diagnostics, files, plugins);
    const resolution = resolveDependencies(program, files, this.emitHost, plugins);
    diagnostics.push(...resolution.diagnostics);
    let resolved = resolution.resolvedFiles;
    if (resolved.some((file) => file.fileName === "lualib_bundle")) {
      resolved = resolved.filter((file) => file.fileName !== "lualib_bundle");
      const luaTarget = options.luaTarget ?? LuaTarget.Universal;
      const code = options.luaLibImport === LuaLibImportKind.RequireMinimal
        ? buildMinimalLualibBundle(findUsedLualibFeatures(luaTarget, this.emitHost, resolved.map((file) => file.code)), luaTarget, this.emitHost)
        : getLuaLibBundle(luaTarget, this.emitHost);
      resolved.unshift({ fileName: normalizeSlashes(resolve(getSourceDir(program), "lualib_bundle.lua")), code });
    }
    const [bundleDiagnostics, bundle] = this.bundler.bundle(program, resolved) ?? getBundleResult(program, resolved);
    diagnostics.push(...bundleDiagnostics);
    return { emitPlan: [bundle] };
  }

  compile(program: ts.Program, affected: readonly ts.SourceFile[], phase: Phase): readonly ts.Diagnostic[] {
    const writeFile = this.emitHost.writeFile;
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

/** A compiler host that parses a file again only when its size or modification time changed. */
function cachingHost(options: ts.CompilerOptions, cache: Map<string, CachedSource>): ts.CompilerHost {
  const host = ts.createIncrementalCompilerHost(options);
  const parse = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const stat = statSync(fileName, { throwIfNoEntry: false });
    const stamp = stat === undefined ? "missing" : `${stat.mtimeMs}:${stat.size}`;
    const cached = cache.get(fileName);
    if (cached?.stamp === stamp && shouldCreateNewSourceFile !== true) return cached.file;
    const file = parse(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    if (file !== undefined) cache.set(fileName, { stamp, file });
    return file;
  };
  return host;
}

export function mapCompiler(configPath: string): (phase?: Phase) => readonly ts.Diagnostic[] {
  // An absolute config path keeps every source file name absolute, which the
  // map plugin needs to recognize f32, floorDiv and floorMod by their file.
  const absolute = resolve(configPath);
  const transpiler = new IncrementalTranspiler();
  const sources = new Map<string, CachedSource>();
  let builder: ts.EmitAndSemanticDiagnosticsBuilderProgram | undefined;
  let signaturesPrimed = false;
  return (phase = defaultPhase) => {
    // Parsed every time so added and removed files are picked up.
    const config = phase("read config", () => parseConfigFileWithSystem(absolute));
    if (config.errors.length > 0) return config.errors;
    config.options.declaration = true;
    const host = cachingHost(config.options, sources);
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
      return transpiler.compile(program, affected, phase);
    } finally {
      program.getDeclarationDiagnostics = declarationDiagnostics;
    }
  };
}

export function report(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}
