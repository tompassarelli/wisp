// The project's runtime import graph, as Bun loads it: each module's static
// imports, re-exports, literal dynamic imports and requires, resolved the way
// Bun resolves them. Type-only imports load nothing and make no edge. Only the
// project's own files are nodes; an installed package changes only through a
// package change, which reruns everything anyway. A module with an `import()`
// of a computed specifier can load anything, so the graph can't say what it
// depends on.
import { readFileSync } from "node:fs";
import { dirname, extname, relative, sep } from "node:path";

const LOADERS: Readonly<Record<string, "ts" | "tsx" | "js" | "jsx">> = {
  ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx",
};
/** `import(` whose argument isn't a string literal. */
const COMPUTED_IMPORT = /\bimport\s*\(\s*(?!["'][^"']*["']\s*[,)]|`[^`$]*`\s*[,)])/;

export const isModulePath = (path: string) => LOADERS[extname(path)] !== undefined;

interface Node {
  readonly imports: readonly string[];
  /** It imports a computed specifier. */
  readonly computed: boolean;
}

export class ImportGraph {
  private readonly nodes = new Map<string, Node>();
  private readonly importers = new Map<string, Set<string>>();
  private readonly transpilers = new Map<string, Bun.Transpiler>();

  /** `root` is the project directory: its files outside node_modules are the graph's modules. */
  constructor(private readonly root: string) {}

  /** Whether `path` is one of the project's modules. */
  owns(path: string): boolean {
    const local = relative(this.root, path);
    return !local.startsWith("..") && !local.split(sep).includes("node_modules") && isModulePath(path);
  }

  /** Whether some scanned module loads `path`, or it is an entry. */
  has(path: string): boolean {
    return this.nodes.has(path);
  }

  /** Scans `entries` and every project module they reach that isn't scanned yet. */
  add(entries: readonly string[]): void {
    const pending = entries.filter((entry) => !this.nodes.has(entry));
    for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
      if (this.nodes.has(path)) continue;
      const node = this.scan(path);
      this.set(path, node);
      for (const imported of node.imports) if (!this.nodes.has(imported)) pending.push(imported);
    }
  }

  /** Scans a changed module again, then anything new it reaches. */
  update(path: string): void {
    const node = this.scan(path);
    this.set(path, node);
    this.add(node.imports);
  }

  /** `path` and every module that loads it, directly or through others. */
  dependents(path: string): Set<string> {
    return this.reach(path, (next) => this.importers.get(next) ?? []);
  }

  /** `path` and every project module it loads, directly or through others. */
  dependencies(path: string): Set<string> {
    return this.reach(path, (next) => this.nodes.get(next)?.imports ?? []);
  }

  /** The first module `path` loads that imports a computed specifier. */
  computedImport(path: string): string | undefined {
    for (const module of this.dependencies(path)) if (this.nodes.get(module)?.computed === true) return module;
    return undefined;
  }

  private reach(path: string, next: (path: string) => Iterable<string>): Set<string> {
    const found = new Set<string>([path]);
    const pending = [path];
    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
      for (const linked of next(current)) {
        if (found.has(linked)) continue;
        found.add(linked);
        pending.push(linked);
      }
    }
    return found;
  }

  private set(path: string, node: Node): void {
    for (const imported of this.nodes.get(path)?.imports ?? []) this.importers.get(imported)?.delete(path);
    this.nodes.set(path, node);
    for (const imported of node.imports) {
      let importers = this.importers.get(imported);
      if (importers === undefined) this.importers.set(imported, importers = new Set());
      importers.add(path);
    }
  }

  private scan(path: string): Node {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return { imports: [], computed: false };
    }
    const loader = LOADERS[extname(path)] ?? "ts";
    let transpiler = this.transpilers.get(loader);
    if (transpiler === undefined) this.transpilers.set(loader, transpiler = new Bun.Transpiler({ loader }));
    let scanned: readonly { readonly path: string }[];
    try {
      scanned = transpiler.scanImports(text);
    } catch {
      // A save that doesn't parse keeps the imports it had; its tests report the syntax error.
      return this.nodes.get(path) ?? { imports: [], computed: false };
    }
    const imports = new Set<string>();
    for (const { path: specifier } of scanned) {
      let resolved: string;
      try {
        resolved = Bun.resolveSync(specifier, dirname(path));
      } catch {
        // A module that doesn't exist yet: creating it reruns everything.
        continue;
      }
      if (this.owns(resolved)) imports.add(resolved);
    }
    return { imports: [...imports], computed: COMPUTED_IMPORT.test(text) };
  }
}
