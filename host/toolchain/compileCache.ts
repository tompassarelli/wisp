import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

const LOCKFILES = ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

const lockfileTexts = (root: string): string[] => {
  for (let directory = root; ; directory = dirname(directory)) {
    const found = LOCKFILES.map((name) => join(directory, name)).filter((file) => existsSync(file));
    if (found.length > 0) return found.map((file) => `${basename(file)}\n${sha(readFileSync(file))}`);
    if (dirname(directory) === directory) return [];
  }
};

const packageRoot = (file: string): string => {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (dirname(directory) === directory) return dirname(file);
  }
};

const resolvedImport = (specifier: string, from: string): string | undefined => {
  try {
    return Bun.resolveSync(specifier, dirname(from));
  } catch {
    return undefined;
  }
};

export const importClosure = (entries: readonly string[], label: (file: string) => string): string[] => {
  const scanner = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const pending = entries.filter((entry) => existsSync(entry));
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const owner = packageRoot(file);
    for (const { path: specifier } of scanner.scanImports(readFileSync(file, "utf8"))) {
      const target = resolvedImport(specifier, file);
      if (target !== undefined && existsSync(target) && packageRoot(target) === owner) pending.push(target);
    }
  }
  return [...seen].map((file) => `${label(file)}\n${readFileSync(file, "utf8")}`).sort();
};

const pluginFiles = (options: ts.CompilerOptions, root: string): string[] => {
  const plugins = (options as { readonly luaPlugins?: readonly { readonly name?: string }[] }).luaPlugins ?? [];
  return plugins.flatMap(({ name }) => {
    if (name === undefined) return [];
    const path = isAbsolute(name) || name.startsWith(".") ? resolve(root, name) : resolvedImport(name, join(root, "tsconfig.json"));
    return path === undefined ? [] : [path];
  });
};

const packageVersion = (name: string) => {
  try {
    return String((JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as { version?: unknown }).version);
  } catch {
    return "unknown";
  }
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
    ts.version,
    packageVersion("typescript-to-lua"),
    packageVersion("source-map"),
    rootText(relative(root, configPath)),
    rootText(JSON.stringify(options)),
    fileNames.map((name) => toStored(resolve(name))),
    importClosure([join(import.meta.dir, "compiler.ts"), ...readdirSync(join(import.meta.dir, "../../plugins")).filter((name) => name.endsWith(".ts")).map((name) => join(import.meta.dir, "../../plugins", name)), ...pluginFiles(options, root)], (file) => file === root || file.startsWith(`${root}/`) ? toStored(file) : relative(packageRoot(file), file)),
    lockfileTexts(root),
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
