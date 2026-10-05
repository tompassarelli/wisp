// The Lua bundle with its source map, rebuilt from cached modules. It equals
// TypeScriptToLua 1.37.1's getBundleResult: the same code, and the source map
// that source-map 0.7.6 serializes. Each module's walk (its text and mappings)
// and its encoded mappings are kept between compiles; only edited modules are
// walked again, and only the deltas that cross a module boundary are encoded
// again. Anything this module does not reproduce is left to TypeScriptToLua.
import type ts from "typescript";
import { getBundleResult, sourceMapTracebackBundlePlaceholder } from "typescript-to-lua/dist/transpilation/bundle";
import { getEmitPathRelativeToOutDir } from "typescript-to-lua/dist/transpilation/transpiler";
import type { EmitFile, ProcessedFile } from "typescript-to-lua/dist/transpilation/utils";
import { escapeString } from "typescript-to-lua/dist/LuaPrinter";
import { formatPathToLuaPath, trimExtension } from "typescript-to-lua/dist/utils";

/** The fields of a source-map SourceNode the bundle reads. */
interface Node {
  readonly children: readonly (Node | string)[];
  readonly line: number | null;
  readonly column: number | null;
  readonly source: string | null;
  readonly name: string | null;
  readonly sourceContents: Record<string, unknown>;
}

/** One module's mappings, lines counted from the line its table entry starts on. */
interface Walk {
  readonly text: string;
  readonly newlines: number;
  /** Per serialized mapping: line, column, local source (-1 unmapped), original line, original column, local name (-1 none). */
  readonly mappings: Int32Array;
  readonly sources: readonly string[];
  readonly names: readonly string[];
}

/** A module's mappings encoded for given global source and name indices. */
interface Encoded {
  readonly sourceIndices: readonly number[];
  readonly nameIndices: readonly number[];
  /** The first mapping's column; its other fields are encoded against the previous module. */
  readonly head: string;
  /** Up to the first named mapping when that is not the first mapping, whose name is encoded against the previous module. */
  readonly middle: string;
  readonly crossName: boolean;
  readonly tail: string;
}

interface Cached {
  readonly node: Node | undefined;
  readonly code: string;
  readonly name: string;
  readonly path: string;
  readonly walk: Walk;
  /** TypeScriptToLua replaces the traceback placeholder wherever it appears, so such text is left to it. */
  readonly placeholder: boolean;
  encoded?: Encoded;
  module?: BundledModule;
}

/** A module of a bundle, as a hot reload sends it (wisp:src/runtime/modules.ts). */
export interface BundledModule {
  /** The name the bundle's require uses. */
  readonly name: string;
  /** Its code: the body of its function in the bundle's module table. */
  readonly code: string;
  /** The source map of its hot-reload chunk, MODULE_HEAD + code + MODULE_TAIL, as JSON. */
  readonly sourceMap: () => string;
}

export interface BundledModules {
  readonly entry: string;
  /** In bundle order. */
  readonly modules: readonly BundledModule[];
}

const FIELDS = 6;
// A module's entry in the bundle's module table, around its code.
const entryHead = (path: string) => `[${path}] = function(...) \n`;
const ENTRY_TAIL = " end,\n";
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SMALL = 2048;
const SMALL_VLQ = Array.from({ length: SMALL * 2 + 1 }, (_, index) => encodeVlq(index - SMALL));

function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    encoded += BASE64[digit];
  } while (vlq > 0);
  return encoded;
}

const vlq = (value: number) => (value >= -SMALL && value <= SMALL ? SMALL_VLQ[value + SMALL]! : encodeVlq(value));

const isNode = (chunk: unknown): chunk is Node =>
  typeof chunk === "object" && chunk !== null && Array.isArray((chunk as { children?: unknown }).children);

/**
 * Walks a module's table entry as SourceNode.toStringWithSourceMap does. The
 * entry starts on a new line with no active mapping, so its mappings depend
 * on nothing before it. Undefined when the generator would reject a mapping or
 * the tree holds source contents.
 */
function walkModule(head: string, content: Node | string, tail: string): Walk | undefined {
  const parts: string[] = [];
  const mappings: number[] = [];
  const sources = new Map<string, number>();
  const names = new Map<string, number>();
  let line = 0;
  let column = 0;
  let newlines = 0;
  let active = false;
  let lastSource: string | null = null;
  let lastLine: number | null = null;
  let lastColumn: number | null = null;
  let lastName: string | null = null;
  let supported = true;

  const add = (atLine: number, atColumn: number, source: string | null, originalLine: number, originalColumn: number, name: string | null) => {
    if (source === null) {
      mappings.push(atLine, atColumn, -1, 0, 0, -1);
      return;
    }
    let sourceIndex = sources.get(source);
    if (sourceIndex === undefined) sources.set(source, sourceIndex = sources.size);
    let nameIndex = -1;
    if (name !== null) {
      nameIndex = names.get(name) ?? -1;
      if (nameIndex < 0) names.set(name, nameIndex = names.size);
    }
    mappings.push(atLine, atColumn, sourceIndex, originalLine, originalColumn, nameIndex);
  };

  const chunk = (text: string, owner: Node | undefined) => {
    if (text === "") return;
    parts.push(text);
    const original = owner !== undefined && owner.source !== null && owner.line !== null && owner.column !== null ? owner : undefined;
    if (original !== undefined) {
      const { source, line: originalLine, column: originalColumn, name } = original;
      if (typeof source !== "string" || source === "" || typeof originalLine !== "number" || typeof originalColumn !== "number"
        || !(originalLine > 0) || !(originalColumn >= 0) || (name !== null && typeof name !== "string")) {
        supported = false;
        return;
      }
      if (lastSource !== source || lastLine !== originalLine || lastColumn !== originalColumn || lastName !== name) {
        add(line, column, source, originalLine, originalColumn, name);
      }
      lastSource = source;
      lastLine = originalLine;
      lastColumn = originalColumn;
      lastName = name;
      active = true;
    } else if (active) {
      add(line, column, null, 0, 0, null);
      lastSource = null;
      active = false;
    }
    let start = 0;
    for (let newline = text.indexOf("\n"); newline >= 0; newline = text.indexOf("\n", start)) {
      line++;
      newlines++;
      column = 0;
      start = newline + 1;
      if (start === text.length) {
        lastSource = null;
        active = false;
      } else if (active && original !== undefined) {
        add(line, 0, original.source, original.line ?? 0, original.column ?? 0, original.name);
      }
    }
    column += text.length - start;
  };

  const visit = (node: Node) => {
    for (const key in node.sourceContents) {
      void key;
      supported = false;
    }
    for (const child of node.children) {
      if (!supported) return;
      if (typeof child === "string") chunk(child, node);
      else if (isNode(child)) visit(child);
      else supported = false;
    }
  };

  chunk(head, undefined);
  if (typeof content === "string") chunk(content, undefined);
  else visit(content);
  if (!supported) return undefined;
  chunk(tail, undefined);
  return {
    text: parts.join(""),
    newlines,
    mappings: dedupe(mappings),
    sources: [...sources.keys()],
    names: [...names.keys()],
  };
}

/** Drops a mapping equal to the one before it on its line, as the generator's serializer does. */
function dedupe(mappings: readonly number[]): Int32Array {
  const kept: number[] = [];
  for (let index = 0; index < mappings.length; index += FIELDS) {
    const previous = kept.length - FIELDS;
    if (previous >= 0 && kept[previous] === mappings[index]) {
      let same = true;
      for (let field = 1; field < FIELDS && same; field++) same = kept[previous + field] === mappings[index + field];
      if (same) continue;
    }
    for (let field = 0; field < FIELDS; field++) kept.push(mappings[index + field]!);
  }
  return Int32Array.from(kept);
}

/**
 * Encodes a module's mappings after its first one. Their deltas stay inside
 * the module, except the first named mapping's name when the first mapping has
 * none; that one is encoded at assembly against the previous module.
 */
function encodeModule(walk: Walk, sourceIndices: readonly number[], nameIndices: readonly number[]): Encoded {
  const m = walk.mappings;
  let previousLine = m[0]!;
  let previousColumn = m[1]!;
  let previousSource = sourceIndices[m[2]!]!;
  let previousOriginalLine = m[3]! - 1;
  let previousOriginalColumn = m[4]!;
  let previousName = m[5]! >= 0 ? nameIndices[m[5]!]! : -1;
  let middle = "";
  let tail = "";
  let crossName = false;
  let afterCross = false;
  for (let index = FIELDS; index < m.length; index += FIELDS) {
    let next = "";
    const line = m[index]!;
    if (line !== previousLine) {
      next += ";".repeat(line - previousLine);
      previousLine = line;
      previousColumn = 0;
    } else {
      next += ",";
    }
    next += vlq(m[index + 1]! - previousColumn);
    previousColumn = m[index + 1]!;
    if (m[index + 2]! >= 0) {
      const source = sourceIndices[m[index + 2]!]!;
      next += vlq(source - previousSource) + vlq(m[index + 3]! - 1 - previousOriginalLine) + vlq(m[index + 4]! - previousOriginalColumn);
      previousSource = source;
      previousOriginalLine = m[index + 3]! - 1;
      previousOriginalColumn = m[index + 4]!;
      if (m[index + 5]! >= 0) {
        const name = nameIndices[m[index + 5]!]!;
        if (previousName < 0) {
          middle += next;
          crossName = true;
          afterCross = true;
          previousName = name;
          continue;
        }
        next += vlq(name - previousName);
        previousName = name;
      }
    }
    if (afterCross) tail += next;
    else middle += next;
  }
  return { sourceIndices, nameIndices, head: vlq(m[1]!), middle, crossName, tail };
}

/**
 * The source map of a module's hot-reload chunk. The chunk's head is one line,
 * as the table entry's head is, and neither is mapped, so the walk's lines and
 * columns are the chunk's.
 */
function chunkSourceMap(walk: Walk): string {
  const m = walk.mappings;
  let mappings = "";
  let line = 0;
  let column = 0;
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  for (let index = 0; index < m.length; index += FIELDS) {
    if (m[index]! !== line) {
      mappings += ";".repeat(m[index]! - line);
      line = m[index]!;
      column = 0;
    } else if (index > 0) {
      mappings += ",";
    }
    mappings += vlq(m[index + 1]! - column);
    column = m[index + 1]!;
    if (m[index + 2]! < 0) continue;
    mappings += vlq(m[index + 2]! - source) + vlq(m[index + 3]! - 1 - originalLine) + vlq(m[index + 4]! - originalColumn);
    source = m[index + 2]!;
    originalLine = m[index + 3]! - 1;
    originalColumn = m[index + 4]!;
    if (m[index + 5]! < 0) continue;
    mappings += vlq(m[index + 5]! - name);
    name = m[index + 5]!;
  }
  return JSON.stringify({ version: 3, sources: walk.sources, names: walk.names, mappings });
}

const sameIndices = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Builds bundles from processed modules, reusing what each module produced last time. */
export class LuaBundler {
  private readonly modules = new Map<string, Cached>();
  /** The modules of the last bundle built here; undefined when TypeScriptToLua built it. */
  bundled: BundledModules | undefined;

  /** The bundle for these resolved modules, or undefined when TypeScriptToLua must build it. */
  bundle(program: ts.Program, files: readonly ProcessedFile[]): [ts.Diagnostic[], EmitFile] | undefined {
    this.bundled = undefined;
    const options = program.getCompilerOptions();
    if (options.sourceMapTraceback) return undefined;
    // The rest of the bundle around an empty module table: the require shim, entry call and diagnostics.
    const [diagnostics, empty] = getBundleResult(program, []);
    const table = "____modules = {\n";
    const tableAt = empty.code.indexOf(`${table}}\n`);
    if (tableAt < 0 || empty.code.indexOf(`${table}}\n`, tableAt + 1) >= 0) return undefined;
    const prefix = empty.code.slice(0, tableAt + table.length);
    const suffix = empty.code.slice(tableAt + table.length);

    const live = new Set<string>();
    const walked: Cached[] = [];
    for (const file of files) {
      live.add(file.fileName);
      const name = formatPathToLuaPath(trimExtension(getEmitPathRelativeToOutDir(file.fileName, program)));
      const path = escapeString(name);
      const node = file.sourceMapNode as unknown as Node | undefined;
      let cached = this.modules.get(file.fileName);
      if (cached === undefined || cached.node !== node || cached.code !== file.code || cached.path !== path) {
        const walk = walkModule(entryHead(path), node ?? file.code, ENTRY_TAIL);
        if (walk === undefined || (walk.mappings.length > 0 && walk.mappings[2]! < 0)) return undefined;
        cached = { node, code: file.code, name, path, walk, placeholder: walk.text.includes(sourceMapTracebackBundlePlaceholder) };
        this.modules.set(file.fileName, cached);
      }
      if (cached.placeholder) return undefined;
      walked.push(cached);
    }
    for (const name of this.modules.keys()) if (!live.has(name)) this.modules.delete(name);

    const sources = new Map<string, number>();
    const names = new Map<string, number>();
    const index = (table: Map<string, number>, value: string) => {
      let found = table.get(value);
      if (found === undefined) table.set(value, found = table.size);
      return found;
    };
    let mappings = "";
    let previousLine = 1;
    let previousSource = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;
    let previousName = 0;
    let start = 1 + prefix.split("\n").length - 1;
    for (const module of walked) {
      const { walk } = module;
      const m = walk.mappings;
      if (m.length > 0) {
        const sourceIndices = walk.sources.map((source) => index(sources, source));
        const nameIndices = walk.names.map((name) => index(names, name));
        if (module.encoded === undefined || !sameIndices(module.encoded.sourceIndices, sourceIndices) || !sameIndices(module.encoded.nameIndices, nameIndices)) {
          module.encoded = encodeModule(walk, sourceIndices, nameIndices);
        }
        const encoded = module.encoded;
        const first = start + m[0]!;
        if (first <= previousLine) return undefined;
        mappings += ";".repeat(first - previousLine) + encoded.head;
        const source = sourceIndices[m[2]!]!;
        mappings += vlq(source - previousSource) + vlq(m[3]! - 1 - previousOriginalLine) + vlq(m[4]! - previousOriginalColumn);
        if (m[5]! >= 0) {
          const name = nameIndices[m[5]!]!;
          mappings += vlq(name - previousName);
          previousName = name;
        }
        mappings += encoded.middle;
        // The module's last mapped and named mappings carry the state to the next module.
        let lastMapped = 0;
        let lastNamed = m[5]! >= 0 ? 0 : -1;
        for (let at = FIELDS; at < m.length; at += FIELDS) {
          if (m[at + 2]! >= 0) lastMapped = at;
          if (m[at + 5]! >= 0) lastNamed = at;
        }
        if (encoded.crossName) {
          let firstNamed = FIELDS;
          while (m[firstNamed + 5]! < 0) firstNamed += FIELDS;
          const name = nameIndices[m[firstNamed + 5]!]!;
          mappings += vlq(name - previousName);
        }
        mappings += encoded.tail;
        previousLine = start + m[m.length - FIELDS]!;
        previousSource = sourceIndices[m[lastMapped + 2]!]!;
        previousOriginalLine = m[lastMapped + 3]! - 1;
        previousOriginalColumn = m[lastMapped + 4]!;
        if (lastNamed >= 0) previousName = nameIndices[m[lastNamed + 5]!]!;
      }
      start += walk.newlines;
    }

    const code = prefix + walked.map(({ walk }) => walk.text).join("") + suffix;
    const sourceMap = JSON.stringify({ version: 3, sources: [...sources.keys()], names: [...names.keys()], mappings });
    const sourceFiles = files.flatMap((file) => file.sourceFiles ?? []);
    const entry = walked.find(({ path }) => suffix.includes(`local ____entry = require(${path}, `));
    if (entry !== undefined) {
      const modules = walked.map((cached) => (cached.module ??= {
        name: cached.name,
        code: cached.walk.text.slice(entryHead(cached.path).length, cached.walk.text.length - ENTRY_TAIL.length),
        sourceMap: () => chunkSourceMap(cached.walk),
      }));
      this.bundled = { entry: entry.name, modules };
    }
    return [diagnostics, { outputPath: empty.outputPath, code, sourceMap, sourceFiles }];
  }
}
