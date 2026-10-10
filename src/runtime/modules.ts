import { NO_BASE, PAYLOAD_FILE_BYTES, deltaFile, payloadFile, type Manifest } from "./gameFiles";
import { checksum } from "./payload";

export interface HotModule {

  readonly name: string;

  readonly text: string;
}

export interface ModuleSet {
  readonly entry: string;
  readonly modules: readonly HotModule[];
}

// A module chunk's head stays one line so source-map line positions match the bundle.

export const MODULE_HEAD = "local require = ... return function(...) \n";
export const MODULE_TAIL = " end\n";
export const moduleChunk = (code: string) => `${MODULE_HEAD}${code}${MODULE_TAIL}`;

export const BUNDLE_MODULE = "bundle";
export const bundleModules = (bundle: string): ModuleSet => ({ entry: BUNDLE_MODULE, modules: [{ name: BUNDLE_MODULE, text: moduleChunk(bundle) }] });

export type Hash = (this: void, text: string) => string;
export const textChecksum: Hash = (text) => checksum(text.length, (index) => text.charCodeAt(index));

export const moduleHashText = (name: string, text: string) => `${name}\n${text}`;

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

  readonly hashes: readonly (readonly [string, string])[];

  readonly texts: Readonly<Record<string, string | undefined>>;
}

function field(line: string): [string, string] | undefined {
  const space = line.indexOf(" ");
  return space <= 0 || space === line.length - 1 ? undefined : [line.slice(0, space), line.slice(space + 1)];
}

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

export interface ModuleState {
  readonly state: string;
  readonly hashes: Readonly<Record<string, string | undefined>>;
}

export interface VersionFiles {
  readonly manifest: Manifest;

  readonly payloads: readonly (readonly [string, string])[];
  readonly published: ModuleState;

  readonly changed: readonly string[];
  readonly changedBytes: number;
  readonly fullBytes: number;
}

export class ModulePublisher {
  private known: Record<string, { readonly text: string; readonly hash: string } | undefined> = {};
  private base: ModuleState | undefined;

  constructor(private readonly prefix: string, private readonly hash: Hash = textChecksum) {}

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
