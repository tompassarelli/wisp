// Reports Warcraft's number rules (wisp:plugins/number-rules.ts) for map
// tsconfigs, as `bun run check` does for the TypeScript 7 checker, which runs
// no plugins. TypeScript 7's API parses and resolves; the rules read its trees.
// A file's findings depend only on its text, so they are cached per file in
// build/number-rules.json; where each finding's identifier is declared, and
// the type of each array whose length is read, are resolved again on every run.
// Usage: bun node_modules/wisp/scripts/numberRules.ts MAP_TSCONFIG...
import { mkdir, rename } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { API, type Checker, SymbolFlags, type Symbol as TsSymbol, type Type, TypeFlags } from "typescript-native/unstable/async";
import * as syntax from "typescript-native/unstable/ast";
import { NUMBER_RULE_CODE, type Declaration, type DeclarationTest, scanNumberRules, stands } from "../plugins/number-rules";

interface CachedFinding {
  readonly start: number;
  readonly message: string;
  readonly condition?: { readonly identifier: number; readonly test: DeclarationTest };
  readonly holeyArray?: number;
}

interface CachedFile {
  readonly hash: string;
  readonly findings: readonly CachedFinding[];
}

interface Cache {
  readonly version: string;
  readonly files: Readonly<Record<string, CachedFile>>;
}

const hash = (text: string) => Bun.hash(text).toString(36);

/** Rule and parser changes invalidate every cached file. */
async function cacheVersion(): Promise<string> {
  const rules = await Bun.file(resolve(import.meta.dir, "../plugins/number-rules.ts")).text();
  const parser: { readonly version: string } = await Bun.file(Bun.fileURLToPath(import.meta.resolve("typescript-native/package.json"))).json();
  return hash(`${parser.version}\0${rules}`);
}

async function readCache(path: string, version: string): Promise<Cache["files"]> {
  try {
    const cache: Cache = await Bun.file(path).json();
    return cache.version === version ? cache.files : {};
  } catch {
    return {};
  }
}

/** isHoleyArray (wisp:plugins/number-rules.ts) through TypeScript 7's checker. */
async function isHoleyArray(checker: Checker, type: Type): Promise<boolean> {
  const mayBeUndefined = async (element: Type): Promise<boolean> => {
    if ((element.flags & (TypeFlags.Undefined | TypeFlags.Void)) !== 0) return true;
    if (!element.isUnionType()) return false;
    for (const member of (await element.getTypes()) ?? []) if (await mayBeUndefined(member)) return true;
    return false;
  };
  if (type.isUnionType()) {
    for (const member of (await type.getTypes()) ?? []) if (await isHoleyArray(checker, member)) return true;
    return false;
  }
  if (!type.isTypeReference() || !(await checker.isArrayType(type) || await checker.isTupleType(type))) return false;
  for (const element of await checker.getTypeArguments(type)) if (await mayBeUndefined(element)) return true;
  return false;
}

/** 1-based line and UTF-16 column, as tsc reports them. */
function position(text: string, offset: number): string {
  let line = 1;
  let lineStart = 0;
  for (let index = text.indexOf("\n"); index !== -1 && index < offset; index = text.indexOf("\n", index + 1)) {
    line++;
    lineStart = index + 1;
  }
  return `${line},${offset - lineStart + 1}`;
}

/** One line per finding, as tsc prints its own errors: `file(line,column): error TS9300: message`. */
export async function numberRuleReport(
  configs: readonly string[],
  { cwd = process.cwd(), cachePath = resolve(cwd, "build/number-rules.json") }: { readonly cwd?: string; readonly cachePath?: string } = {},
): Promise<string[]> {
  const version = await cacheVersion();
  const cached = await readCache(cachePath, version);
  const files: Record<string, CachedFile> = {};
  const reports = new Map<string, { readonly file: string; readonly start: number; readonly line: string }>();
  const api = new API({ cwd });
  try {
    const configPaths = configs.map((config) => resolve(cwd, config));
    const snapshot = await api.updateSnapshot({ openProjects: configPaths });
    for (const configPath of configPaths) {
      const project = snapshot.getProject(configPath);
      if (project === undefined) throw new Error(`${configPath}: TypeScript did not load this project`);
      const { program, checker } = project;
      const names = await program.getSourceFileNames();
      const metadata = await Promise.all(names.map((name) => program.getSourceFileMetadata(name)));
      // The compiler checks every file it compiles except declarations and installed libraries.
      const candidates = names.filter((_, index) => !metadata[index]?.isDefaultLibrary && !metadata[index]?.isFromExternalLibrary);
      const libraries = new Map<syntax.Path, Promise<boolean>>();
      const isDefaultLibrary = (path: syntax.Path) => {
        let known = libraries.get(path);
        if (known === undefined) libraries.set(path, known = program.getSourceFileMetadataByPath(path).then((data) => data?.isDefaultLibrary ?? false));
        return known;
      };
      const symbols = new Map<number, Promise<Declaration[]>>();
      const declarations = (symbol: TsSymbol | undefined): Promise<Declaration[]> => {
        if (symbol === undefined) return Promise.resolve([]);
        let known = symbols.get(symbol.id);
        if (known === undefined) {
          symbols.set(symbol.id, known = (async () => {
            const target = symbol.flags & SymbolFlags.Alias ? await checker.getAliasedSymbol(symbol) : symbol;
            return Promise.all(target.declarations.map(async ({ path }) => ({ fileName: path, isDefaultLibrary: await isDefaultLibrary(path) })));
          })());
        }
        return known;
      };
      await Promise.all(candidates.map(async (name) => {
        let text = await Bun.file(name).text();
        let entry = files[name] ?? cached[name];
        if (entry?.hash !== hash(text)) {
          const file = await program.getSourceFile(name);
          if (file === undefined) throw new Error(`${name}: TypeScript did not load this file`);
          text = file.text;
          const findings = file.isDeclarationFile ? [] : scanNumberRules<syntax.Node>(syntax, file).map(({ node, message, condition, holeyArray }): CachedFinding => ({
            start: node.getStart(file),
            message,
            ...(condition === undefined ? {} : { condition: { identifier: condition.identifier.getStart(file), test: condition.test } }),
            ...(holeyArray === undefined ? {} : { holeyArray: holeyArray.getStart(file) }),
          }));
          entry = { hash: hash(text), findings };
        }
        files[name] = entry;
        const positions = entry.findings.flatMap(({ condition }) => (condition === undefined ? [] : [condition.identifier]));
        const resolved = positions.length === 0 ? [] : await checker.getSymbolAtPosition(name, positions);
        const arrays = entry.findings.flatMap(({ holeyArray }) => (holeyArray === undefined ? [] : [holeyArray]));
        const types = arrays.length === 0 ? [] : await checker.getTypeAtPosition(name, arrays);
        let next = 0;
        let nextArray = 0;
        for (const { start, message, condition, holeyArray } of entry.findings) {
          if (condition !== undefined && !stands(condition.test, await declarations(resolved[next++]))) continue;
          if (holeyArray !== undefined) {
            const type = types[nextArray++];
            if (type === undefined || !(await isHoleyArray(checker, type))) continue;
          }
          const file = relative(cwd, name);
          reports.set(`${name}\0${start}\0${message}`, { file, start, line: `${file}(${position(text, start)}): error TS${NUMBER_RULE_CODE}: ${message}` });
        }
      }));
    }
  } finally {
    await api.close();
  }
  await mkdir(dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}`;
  await Bun.write(temporary, JSON.stringify({ version, files } satisfies Cache));
  await rename(temporary, cachePath);
  return [...reports.values()].sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start).map(({ line }) => line);
}

if (import.meta.main) {
  const configs = process.argv.slice(2);
  if (configs.length === 0) {
    console.error("usage: bun scripts/numberRules.ts MAP_TSCONFIG...");
    process.exit(2);
  }
  const lines = await numberRuleReport(configs);
  for (const line of lines) console.log(line);
  process.exit(lines.length === 0 ? 0 : 1);
}
