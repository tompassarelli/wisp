import { readFileSync } from "node:fs";
import { dirname, extname, relative, sep } from "node:path";

const LOADERS: Readonly<Record<string, "ts" | "tsx" | "js" | "jsx">> = {
  ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx",
};

const COMPUTED_IMPORT = /\bimport\s*\(\s*(?!["'][^"']*["']\s*[,)]|`[^`$]*`\s*[,)])/;

export const isModulePath = (path: string) => LOADERS[extname(path)] !== undefined;

interface Node {
  readonly imports: readonly string[];

  readonly computed: boolean;
}

export class ImportGraph {
  private readonly nodes = new Map<string, Node>();
  private readonly importers = new Map<string, Set<string>>();
  private readonly transpilers = new Map<string, Bun.Transpiler>();

  constructor(private readonly root: string) {}

  owns(path: string): boolean {
    const local = relative(this.root, path);
    return !local.startsWith("..") && !local.split(sep).includes("node_modules") && isModulePath(path);
  }

  has(path: string): boolean {
    return this.nodes.has(path);
  }

  add(entries: readonly string[]): void {
    const pending = entries.filter((entry) => !this.nodes.has(entry));
    for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
      if (this.nodes.has(path)) continue;
      const node = this.scan(path);
      this.set(path, node);
      for (const imported of node.imports) if (!this.nodes.has(imported)) pending.push(imported);
    }
  }

  update(path: string): void {
    const node = this.scan(path);
    this.set(path, node);
    this.add(node.imports);
  }

  dependents(path: string): Set<string> {
    return this.reach(path, (next) => this.importers.get(next) ?? []);
  }

  dependencies(path: string): Set<string> {
    return this.reach(path, (next) => this.nodes.get(next)?.imports ?? []);
  }

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

      return this.nodes.get(path) ?? { imports: [], computed: false };
    }
    const imports = new Set<string>();
    for (const { path: specifier } of scanned) {
      let resolved: string;
      try {
        resolved = Bun.resolveSync(specifier, dirname(path));
      } catch {

        continue;
      }
      if (this.owns(resolved)) imports.add(resolved);
    }
    return { imports: [...imports], computed: COMPUTED_IMPORT.test(text) };
  }
}
