import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { SourceNode } from "source-map";
import ts from "typescript";
import type { ProcessedFile } from "typescript-to-lua/dist/transpilation/utils";

const STORE_VERSION = 1;
const ROOT = "<root>/";

type StoredChunk = string | StoredNode;

interface StoredNode {
  readonly l: number | null;
  readonly c: number | null;
  readonly s: string | null;
  readonly n: string | null;
  readonly ch: readonly StoredChunk[];
  readonly sc?: Readonly<Record<string, string>>;
}

interface StoredModule {
  readonly file: string;
  readonly code: string;
  readonly map?: string;
  readonly node?: StoredNode;
}

interface Store {
  readonly version: number;
  readonly key: string;
  readonly buildInfo: string;
  readonly modules: readonly string[];
}

interface LiveNode {
  readonly children: readonly (LiveNode | string)[];
  readonly line: number | null;
  readonly column: number | null;
  readonly source: string | null;
  readonly name: string | null;
  readonly sourceContents: Record<string, string>;
}

export interface CompileCache {
  readonly buildInfoFile: string;
  readonly restore: () => { readonly buildInfo: string; readonly modules: (program: ts.Program) => ProcessedFile[] } | undefined;
  readonly save: (buildInfo: string, modules: readonly ProcessedFile[]) => void;
}

const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

const packageRoot = (file: string): string => {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (dirname(directory) === directory) return dirname(file);
  }
};

const resolvedImport = (specifier: string, from: string, kind: Bun.ImportKind): string | undefined => {
  try {
    return kind === "require-call" || kind === "require-resolve" ? createRequire(from).resolve(specifier) : Bun.resolveSync(specifier, dirname(from));
  } catch {
    return undefined;
  }
};

const LOADERS: Readonly<Record<string, Bun.JavaScriptLoader>> = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "jsx", ".jsx": "jsx", ".mjs": "js", ".cjs": "js" };

const scanners = new Map<Bun.JavaScriptLoader, Bun.Transpiler>();

const scanner = (loader: Bun.JavaScriptLoader) => {
  const known = scanners.get(loader);
  if (known !== undefined) return known;
  const created = new Bun.Transpiler({ loader });
  scanners.set(loader, created);
  return created;
};

const scannedImports = (file: string, text: string): Bun.Import[] => {
  const loader = LOADERS[extname(file)];
  if (loader === undefined) return [];
  try {
    return scanner(loader).scanImports(text);
  } catch {
    return [];
  }
};

const RUNTIME_DATA: Readonly<Record<string, string>> = { "typescript-to-lua": "dist/lualib", "source-map": "lib/mappings.wasm" };

const filesUnder = (path: string): string[] => statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => filesUnder(join(path, name))) : [path];

const runtimeData = (root: string): string[] => {
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) return [];
  const data = RUNTIME_DATA[String((JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name)];
  return data === undefined || !existsSync(join(root, data)) ? [] : filesUnder(join(root, data));
};

interface LoadedModule {
  readonly digest: string;
  readonly imports: readonly string[];
}

const loadedModules = new Map<string, LoadedModule>();

const loadedModule = (file: string): LoadedModule => {
  const known = loadedModules.get(file);
  if (known !== undefined) return known;
  const bytes = readFileSync(file);
  const imports = scannedImports(file, bytes.toString()).flatMap(({ path: specifier, kind }) => {
    const target = resolvedImport(specifier, file, kind);
    return target !== undefined && isAbsolute(target) && existsSync(target) ? [target] : [];
  });
  const loaded = { digest: sha(bytes), imports };
  loadedModules.set(file, loaded);
  return loaded;
};

const importClosure = (entries: readonly string[], label: (file: string) => string): string[] => {
  const seen = new Set<string>();
  const pending = entries.filter((entry) => existsSync(entry));
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...loadedModule(file).imports);
  }
  const data = [...new Set([...seen].map(packageRoot))].flatMap(runtimeData);
  return [...seen, ...data].map((file) => `${label(file)}\n${loadedModule(file).digest}`).sort();
};

const tstlResolve = createRequire(require.resolve("typescript-to-lua"))("resolve") as { readonly sync: (id: string, options: { readonly basedir: string; readonly extensions: readonly string[] }) => string };

const pluginFiles = (options: ts.CompilerOptions, root: string): string[] => {
  const plugins = (options as { readonly luaPlugins?: readonly { readonly name?: string }[] }).luaPlugins ?? [];
  return plugins.flatMap(({ name }) => {
    if (name === undefined) return [];
    try {
      return [tstlResolve.sync(name, { basedir: root, extensions: [".js", ".ts", ".tsx"] })];
    } catch {
      return [];
    }
  });
};

type Rebase = (path: string) => string;

const storeNode = (node: LiveNode, toStored: Rebase): StoredNode => {
  const contents = Object.entries(node.sourceContents ?? {});
  return {
    l: node.line,
    c: node.column,
    s: node.source === null ? null : toStored(node.source),
    n: node.name,
    ch: node.children.map((child) => typeof child === "string" ? child : storeNode(child, toStored)),
    ...(contents.length === 0 ? {} : { sc: Object.fromEntries(contents.map(([source, text]) => [toStored(source.replace(/^\$/, "")), text])) }),
  };
};

const liveNode = (node: StoredNode, fromStored: Rebase): SourceNode => {
  const live = new SourceNode(node.l as number, node.c as number, node.s === null ? (null as unknown as string) : fromStored(node.s), node.ch.map((child) => typeof child === "string" ? child : liveNode(child, fromStored)), node.n ?? undefined);
  for (const [source, text] of Object.entries(node.sc ?? {})) live.setSourceContent(fromStored(source), text);
  return live;
};

const storeKey = (root: string, configPath: string, options: ts.CompilerOptions, fileNames: readonly string[], toStored: Rebase) => {
  const rootText = (text: string) => text.replaceAll(root, "<root>");
  return sha(JSON.stringify([
    STORE_VERSION,
    rootText(relative(root, configPath)),
    rootText(JSON.stringify(options)),
    fileNames.map((name) => toStored(resolve(name))),
    importClosure([join(import.meta.dir, "compiler.ts"), ...readdirSync(join(import.meta.dir, "../../plugins")).filter((name) => name.endsWith(".ts")).map((name) => join(import.meta.dir, "../../plugins", name)), ...pluginFiles(options, root)], (file) => file === root || file.startsWith(`${root}/`) ? toStored(file) : relative(packageRoot(file), file)),
  ]));
};

export function compileCache(directory: string, configPath: string, options: ts.CompilerOptions, fileNames: readonly string[]): CompileCache {
  const root = dirname(configPath);
  const toStored = (path: string) => path === root || path.startsWith(`${root}/`) ? `${ROOT}${relative(root, path)}` : path;
  const fromStored = (path: string) => path.startsWith(ROOT) ? join(root, path.slice(ROOT.length)) : path;
  const key = storeKey(root, configPath, options, fileNames, toStored);
  const store = join(directory, key);
  const indexPath = join(store, "index.json");
  const modulePath = (id: string) => join(store, `${id}.json`);
  const known = new WeakMap<ProcessedFile, string>();

  const liveModule = (program: ts.Program, id: string): ProcessedFile => {
    const module = JSON.parse(readFileSync(modulePath(id), "utf8")) as StoredModule;
    const fileName = fromStored(module.file);
    const source = program.getSourceFile(fileName);
    const file: ProcessedFile = {
      fileName,
      code: module.code,
      ...(module.map === undefined ? {} : { sourceMap: module.map }),
      ...(module.node === undefined ? {} : { sourceMapNode: liveNode(module.node, fromStored) }),
      ...(source === undefined ? {} : { sourceFiles: [source] }),
    };
    known.set(file, id);
    return file;
  };

  const storedModule = (file: ProcessedFile): string => {
    const id = known.get(file);
    if (id !== undefined) return id;
    const text = JSON.stringify({
      file: toStored(file.fileName),
      code: file.code,
      ...(file.sourceMap === undefined ? {} : { map: file.sourceMap }),
      ...(file.sourceMapNode === undefined ? {} : { node: storeNode(file.sourceMapNode as unknown as LiveNode, toStored) }),
    } satisfies StoredModule);
    const written = sha(text);
    if (!existsSync(modulePath(written))) writeAtomic(modulePath(written), text);
    known.set(file, written);
    return written;
  };

  return {
    buildInfoFile: join(root, ".wisp-compile.tsbuildinfo"),
    restore: () => {
      let index: Store;
      try {
        index = JSON.parse(readFileSync(indexPath, "utf8")) as Store;
      } catch {
        return undefined;
      }
      if (index.version !== STORE_VERSION || index.key !== key || !index.modules.every((id) => existsSync(modulePath(id)))) return undefined;
      return { buildInfo: index.buildInfo, modules: (program) => index.modules.map((id) => liveModule(program, id)) };
    },
    save: (buildInfo, modules) => {
      mkdirSync(store, { recursive: true });
      const ids = modules.map(storedModule);
      writeAtomic(indexPath, JSON.stringify({ version: STORE_VERSION, key, buildInfo, modules: ids } satisfies Store));
      const live = new Set(ids.map((id) => `${id}.json`));
      for (const name of readdirSync(store)) if (name.endsWith(".json") && name !== "index.json" && !live.has(name)) rmSync(join(store, name), { force: true });
      pruneStores(directory);
    },
  };
}

const STORES_KEPT = 8;

const pruneStores = (directory: string) => {
  const stores = readdirSync(directory).filter((name) => /^[0-9a-f]{64}$/.test(name) && existsSync(join(directory, name, "index.json")))
    .map((name) => ({ path: join(directory, name), used: statSync(join(directory, name, "index.json")).mtimeMs }))
    .sort((left, right) => right.used - left.used);
  for (const { path } of stores.slice(STORES_KEPT)) rmSync(path, { recursive: true, force: true });
};

const writeAtomic = (path: string, text: string) => {
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, text);
  renameSync(staged, path);
};
