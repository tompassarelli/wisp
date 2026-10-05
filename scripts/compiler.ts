// A map compiler that stays warm between compiles. TypeScript's builder
// program works out which files an edit affects (the edited files, and their
// dependents when an exported declaration changed); only those are type-checked
// and transformed to Lua again. Every other module's Lua comes from the previous
// compile, and the bundle is rebuilt from all modules in program order, so the
// output equals a full compile's.
import { statSync } from "node:fs";
import { normalize, resolve } from "node:path";
import ts from "typescript";
import { Transpiler, parseConfigFileWithSystem } from "typescript-to-lua";
import { getPlugins } from "typescript-to-lua/dist/transpilation/plugins";
import { getProgramTranspileResult } from "typescript-to-lua/dist/transpilation/transpile";
import type { ProcessedFile } from "typescript-to-lua/dist/transpilation/utils";

class IncrementalTranspiler extends Transpiler {
  /** Each module's Lua as first printed; bundling rewrites requires, so it only ever sees copies. */
  private readonly modules = new Map<string, ProcessedFile>();

  compile(program: ts.Program, affected: readonly ts.SourceFile[]): readonly ts.Diagnostic[] {
    const started = performance.now();
    const { diagnostics: pluginDiagnostics, plugins } = getPlugins(program);
    if (pluginDiagnostics.length > 0) return pluginDiagnostics;
    const pluginDone = performance.now();
    const writeFile = this.emitHost.writeFile;
    const { diagnostics, transpiledFiles } = getProgramTranspileResult(this.emitHost, writeFile, { program, plugins, sourceFiles: [...affected] });
    if (diagnostics.length > 0) return diagnostics;
    const transpileDone = performance.now();
    for (const file of transpiledFiles) this.modules.set(file.fileName, file);
    const ordered: ProcessedFile[] = [];
    const live = new Set<string>();
    for (const source of program.getSourceFiles()) {
      const name = normalize(source.fileName);
      live.add(name);
      const module = this.modules.get(name);
      if (module !== undefined) ordered.push({ ...module });
    }
    for (const name of this.modules.keys()) if (!live.has(name)) this.modules.delete(name);
    const planDiagnostics: ts.Diagnostic[] = [];
    const { emitPlan } = this.getEmitPlan(program, planDiagnostics, ordered, plugins);
    if (planDiagnostics.length > 0) return planDiagnostics;
    const planDone = performance.now();
    const { sourceMap: writeSourceMap = false, emitBOM = false } = program.getCompilerOptions();
    for (const { outputPath, code, sourceMap, sourceFiles } of emitPlan) {
      writeFile(outputPath, code, emitBOM, undefined, sourceFiles);
      if (writeSourceMap && sourceMap !== undefined) writeFile(`${outputPath}.map`, sourceMap, emitBOM, undefined, sourceFiles);
    }
    if (process.env.COMPILER_TIMINGS !== undefined) console.log(`TSTL plugins ${(pluginDone - started).toFixed(1)} ms, transpile ${(transpileDone - pluginDone).toFixed(1)} ms, bundle-plan ${(planDone - transpileDone).toFixed(1)} ms, writes ${(performance.now() - planDone).toFixed(1)} ms; affected ${affected.length}`);
    return [];
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

export function mapCompiler(configPath: string): () => readonly ts.Diagnostic[] {
  // An absolute config path keeps every source file name absolute, which the
  // map plugin needs to recognize f32, floorDiv and floorMod by their file.
  const absolute = resolve(configPath);
  const transpiler = new IncrementalTranspiler();
  const sources = new Map<string, CachedSource>();
  let builder: ts.EmitAndSemanticDiagnosticsBuilderProgram | undefined;
  let signaturesPrimed = false;
  return () => {
    const started = performance.now();
    // Parsed every time so added and removed files are picked up.
    const config = parseConfigFileWithSystem(absolute);
    if (config.errors.length > 0) return config.errors;
    config.options.declaration = true;
    const host = cachingHost(config.options, sources);
    builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(config.fileNames, config.options, host, builder);
    const program = builder.getProgram();
    const builderDone = performance.now();
    const global = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (global.length > 0) return global;
    const affected: ts.SourceFile[] = [];
    const diagnostics: ts.Diagnostic[] = [];
    for (let next = builder.getSemanticDiagnosticsOfNextAffectedFile(); next !== undefined; next = builder.getSemanticDiagnosticsOfNextAffectedFile()) {
      // A whole-program result (after an options change) means every file is affected.
      const files = "fileName" in next.affected ? [next.affected] : next.affected.getSourceFiles();
      for (const file of files) {
        if (file.isDeclarationFile) continue;
        affected.push(file);
        diagnostics.push(...program.getSyntacticDiagnostics(file));
      }
      diagnostics.push(...next.result);
    }
    if (!signaturesPrimed) {
      const declarations = builder.emit(undefined, () => {}, undefined, true);
      diagnostics.push(...declarations.diagnostics);
      signaturesPrimed = declarations.diagnostics.length === 0 && diagnostics.length === 0;
    }
    const checkDone = performance.now();
    if (diagnostics.length > 0) return diagnostics;
    // Both TSTL and TypeScript's emit gate request whole-program declaration
    // diagnostics. Route those through the builder's dependency-aware cache.
    // Its per-file requests still use the program's checker; re-entry also
    // handles an option change that makes the whole program affected.
    const declarationDiagnostics = program.getDeclarationDiagnostics;
    const incrementalDeclarations = builder.getDeclarationDiagnostics;
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
      const result = transpiler.compile(program, affected);
      if (process.env.COMPILER_TIMINGS !== undefined) console.log(`config+builder ${(builderDone - started).toFixed(1)} ms, semantic diagnostics ${(checkDone - builderDone).toFixed(1)} ms`);
      return result;
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
