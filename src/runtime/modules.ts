// Hot reload by module (wisp:docs/hot-reload.md). A reload installs a module
// set: the map's code as modules, each a Lua chunk a client loads once and
// links again on every later reload. A version's payload starts with its
// index, every module's name and hash, whose checksum names the version's
// state; then it carries module texts: all of them in the full payload, and in
// a delta only those a base state lacks. A client running the base reads the
// delta and takes every other module from its installed table, so it never
// reads, checks or compiles an unchanged module again; any other client reads
// the full payload.
//
// Shared by the host, which writes the files, the headless runtime and the
// map, which reads them. Texts are byte strings, one character per byte, as
// Lua's strings are.
import { NO_BASE, PAYLOAD_FILE_BYTES, deltaFile, payloadFile, type Manifest } from "./gameFiles";
import { checksum } from "./payload";

export interface HotModule {
  /** The name the bundle's require uses. */
  readonly name: string;
  /** Its chunk: MODULE_HEAD, the module's code, MODULE_TAIL. */
  readonly text: string;
}

/** The map's code as modules, and the one whose exports have install(). */
export interface ModuleSet {
  readonly entry: string;
  readonly modules: readonly HotModule[];
}

/**
 * Around a module's code, as TypeScriptToLua's bundle has it, the chunk takes
 * the require to link against and returns the module's function. The head is
 * one line, as the bundle's table entry head is, so the code keeps its lines.
 */
export const MODULE_HEAD = "local require = ... return function(...) \n";
export const MODULE_TAIL = " end\n";
export const moduleChunk = (code: string) => `${MODULE_HEAD}${code}${MODULE_TAIL}`;

/** The one module of a whole bundle, for a compile with no per-module output. */
export const BUNDLE_MODULE = "bundle";
export const bundleModules = (bundle: string): ModuleSet => ({ entry: BUNDLE_MODULE, modules: [{ name: BUNDLE_MODULE, text: moduleChunk(bundle) }] });

/** The checksum of a byte string. */
export type Hash = (this: void, text: string) => string;
export const textChecksum: Hash = (text) => checksum(text.length, (index) => text.charCodeAt(index));

/** What a module's hash covers: its name too, so equal code under two names keeps two source maps. */
export const moduleHashText = (name: string, text: string) => `${name}\n${text}`;

/** The entry's name, then a line per module: its hash and name. Its checksum is the state's. */
export function moduleIndex(entry: string, hashes: readonly (readonly [name: string, hash: string])[]): string {
  const lines = [entry];
  for (const [name, hash] of hashes) lines.push(`${hash} ${name}`);
  return `${lines.join("\n")}\n`;
}

/** The index, a blank line, a line per carried module (its byte length and name), a blank line, then their texts. */
export function modulePayload(index: string, carried: readonly HotModule[]): string {
  const lines: string[] = [];
  const texts: string[] = [];
  for (const module of carried) {
    lines.push(`${module.text.length} ${module.name}\n`);
    texts.push(module.text);
  }
  return `${index}\n${lines.join("")}\n${texts.join("")}`;
}

export interface Payload {
  readonly index: string;
  readonly entry: string;
  /** Every module of the state, in index order: name and hash. */
  readonly hashes: readonly (readonly [string, string])[];
  /** Name to text of each module the payload carries. */
  readonly texts: Readonly<Record<string, string | undefined>>;
}

/** Splits `line` at its first space: the field, and the name after it. */
function field(line: string): [string, string] | undefined {
  const space = line.indexOf(" ");
  return space <= 0 || space === line.length - 1 ? undefined : [line.slice(0, space), line.slice(space + 1)];
}

/** A payload's index and texts; undefined when it is cut short, too long or malformed. */
export function parsePayload(text: string): Payload | undefined {
  const indexEnd = text.indexOf("\n\n");
  if (indexEnd < 0) return undefined;
  const index = text.slice(0, indexEnd + 1);
  const lines = text.slice(0, indexEnd).split("\n");
  const entry = lines[0];
  if (entry === undefined || entry === "") return undefined;
  const hashes: [string, string][] = [];
  const indexed: Record<string, boolean | undefined> = {};
  for (let at = 1; at < lines.length; at++) {
    const parsed = field(lines[at] ?? "");
    if (parsed === undefined) return undefined;
    hashes.push([parsed[1], parsed[0]]);
    indexed[parsed[1]] = true;
  }
  const carried: [string, number][] = [];
  let at = indexEnd + 2;
  while (true) {
    const end = text.indexOf("\n", at);
    if (end < 0) return undefined;
    if (end === at) break;
    const parsed = field(text.slice(at, end));
    if (parsed === undefined || indexed[parsed[1]] !== true) return undefined;
    const length = Number(parsed[0]);
    if (!(length >= 0)) return undefined;
    carried.push([parsed[1], length]);
    at = end + 1;
  }
  at++;
  const texts: Record<string, string | undefined> = {};
  for (const [name, length] of carried) {
    if (at + length > text.length) return undefined;
    texts[name] = text.slice(at, at + length);
    at += length;
  }
  if (at !== text.length) return undefined;
  return { index, entry, hashes, texts };
}

/** Pieces of at most PAYLOAD_FILE_BYTES, cut before an ASCII byte so no UTF-8 character is split. */
export function payloadPieces(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + PAYLOAD_FILE_BYTES, text.length);
    while (end < text.length && text.charCodeAt(end) >= 0x80) end--;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

/** A published state: its hash and each module's. */
export interface ModuleState {
  readonly state: string;
  readonly hashes: Readonly<Record<string, string | undefined>>;
}

/** What the host writes for a version, payload files first; the manifest names them. */
export interface VersionFiles {
  readonly manifest: Manifest;
  /** Game paths and texts. */
  readonly payloads: readonly (readonly [string, string])[];
  readonly published: ModuleState;
  /** The modules a client running the base reads, and their bytes; every module and the full payload's bytes without a base. */
  readonly changed: readonly string[];
  readonly changedBytes: number;
  readonly fullBytes: number;
}

/**
 * Builds each version's files. A module's hash is computed again only when its
 * text changed; a version offers a delta from the newest state every client
 * installed, which `installed` names.
 */
export class ModulePublisher {
  private known: Record<string, { readonly text: string; readonly hash: string } | undefined> = {};
  private base: ModuleState | undefined;

  constructor(private readonly prefix: string, private readonly hash: Hash = textChecksum) {}

  /** Every client installed `state`: later versions carry only what differs from it. */
  installed(state: ModuleState): void {
    this.base = state;
  }

  files(version: number, set: ModuleSet): VersionFiles {
    const hashes: [string, string][] = [];
    const byName: Record<string, string | undefined> = {};
    const known: Record<string, { readonly text: string; readonly hash: string } | undefined> = {};
    for (const module of set.modules) {
      let hashed = this.known[module.name];
      if (hashed === undefined || hashed.text !== module.text) hashed = { text: module.text, hash: this.hash(moduleHashText(module.name, module.text)) };
      known[module.name] = hashed;
      hashes.push([module.name, hashed.hash]);
      byName[module.name] = hashed.hash;
    }
    this.known = known;
    const index = moduleIndex(set.entry, hashes);
    const state = this.hash(index);
    const full = payloadPieces(modulePayload(index, set.modules));
    const payloads: [string, string][] = [];
    let fullBytes = 0;
    for (let piece = 0; piece < full.length; piece++) {
      payloads.push([payloadFile(state, piece, this.prefix), full[piece] ?? ""]);
      fullBytes += (full[piece] ?? "").length;
    }
    const base = this.base;
    let changed = set.modules;
    let changedBytes = fullBytes;
    let changes = 0;
    if (base !== undefined) {
      changed = set.modules.filter((module) => base.hashes[module.name] !== byName[module.name]);
      const delta = payloadPieces(modulePayload(index, changed));
      changedBytes = 0;
      for (let piece = 0; piece < delta.length; piece++) {
        payloads.push([deltaFile(state, base.state, piece, this.prefix), delta[piece] ?? ""]);
        changedBytes += (delta[piece] ?? "").length;
      }
      changes = delta.length;
    }
    return {
      manifest: { version, state, files: full.length, base: base === undefined ? NO_BASE : base.state, changes },
      payloads,
      published: { state, hashes: byName },
      changed: changed.map((module) => module.name),
      changedBytes,
      fullBytes,
    };
  }
}
