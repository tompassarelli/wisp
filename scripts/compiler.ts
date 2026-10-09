







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
import { handleWarnings } from "./handleWarnings";
export { reportHandleWarnings } from "./handleWarnings";


export type Phase = <A>(name: string, run: () => A) => A;


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

  readonly dependencies: readonly ProcessedFile[];
}

class IncrementalTranspiler extends Transpiler {

  private readonly modules = new Map<string, CachedModule>();
  private readonly bundler = new LuaBundler();

  private readonly resolutions = new Map<string, Resolution>();
  private readonly resolvedTrees = new Set<CachedModule>();
  private resolvedProgramFiles = "";


  get bundled(): BundledModules | undefined {
    return this.bundler.bundled;
  }


  protected override getEmitPlan(program: ts.Program, diagnostics: ts.Diagnostic[], files: ProcessedFile[], plugins: Plugin[]): { emitPlan: EmitFile[] } {
    const options: CompilerOptions = program.getCompilerOptions();
    if (!isBundleEnabled(options)) return super.getEmitPlan(program, diagnostics, files, plugins);


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
      for (const module of this.modules.values()) this.resolvedTrees.add(module);
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

    const full = fullResolution();
    if (!cached) diagnostics.push(...full.diagnostics);
    const [bundleDiagnostics, bundle] = getBundleResult(program, full.resolved);
    diagnostics.push(...bundleDiagnostics);
    return { emitPlan: [bundle] };
  }








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
        const cached = this.modules.get(file.fileName);
        if (cached !== undefined) this.resolvedTrees.add(cached);
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


        for (const module of this.resolvedTrees) {
          for (const { node, children } of module.sourceMapChildren) node.children = children;
        }
        this.resolvedTrees.clear();
      }
      const { emitPlan } = plan;
      if (planDiagnostics.length > 0) return planDiagnostics;
      const options: CompilerOptions = program.getCompilerOptions();

      const emitDiagnostics: ts.Diagnostic[] = [];
      for (const plugin of transpiled.plugins) emitDiagnostics.push(...(plugin.beforeEmit?.(program, options, this.emitHost, emitPlan) ?? []));
      const { sourceMap: writeSourceMap = false, emitBOM = false } = options;
      for (const { outputPath, code, sourceMap, sourceFiles } of emitPlan) {
        writeFile(outputPath, code, emitBOM, undefined, sourceFiles);
        if (writeSourceMap && sourceMap !== undefined) writeFile(`${outputPath}.map`, sourceMap, emitBOM, undefined, sourceFiles);
      }
      for (const plugin of transpiled.plugins) emitDiagnostics.push(...(plugin.afterEmit?.(program, options, this.emitHost, emitPlan) ?? []));
      return emitDiagnostics;
    });
  }
}

interface CachedSource {
  readonly stamp: string;
  readonly file: ts.SourceFile;
}





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

  readonly modules: () => BundledModules | undefined;
  readonly warnings: () => readonly ts.Diagnostic[];
}

const noReplacements = (): ReadonlyMap<string, string> => new Map();






export function mapCompiler(configPath: string, sources: () => ReadonlyMap<string, string> = noReplacements): MapCompiler {


  const absolute = resolve(configPath);
  const transpiler = new IncrementalTranspiler();
  const parsed = new Map<string, CachedSource>();
  let builder: ts.EmitAndSemanticDiagnosticsBuilderProgram | undefined;
  let signaturesPrimed = false;
  let warnings: readonly ts.Diagnostic[] = [];
  const compile = (phase: Phase = defaultPhase): readonly ts.Diagnostic[] => {

    const config = phase("read config", () => parseConfigFileWithSystem(absolute));
    if (config.errors.length > 0) return config.errors;
    config.options.declaration = true;
    const replaced = sources();
    const host = cachingHost(config.options, parsed, replaced);
    const current = phase("create program", () => ts.createEmitAndSemanticDiagnosticsBuilderProgram(config.fileNames, config.options, host, builder));
    builder = current;
    const program = current.getProgram();
    warnings = phase("handle cleanup", () => handleWarnings(program));
    const global = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (global.length > 0) return global;
    const { affected, diagnostics } = phase("type-check", () => {
      const affected: ts.SourceFile[] = [];
      const diagnostics: ts.Diagnostic[] = [];
      for (let next = current.getSemanticDiagnosticsOfNextAffectedFile(); next !== undefined; next = current.getSemanticDiagnosticsOfNextAffectedFile()) {

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
  return Object.assign(compile, { modules: () => transpiler.bundled, warnings: () => warnings });
}

export function report(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}
