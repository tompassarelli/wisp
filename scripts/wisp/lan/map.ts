// What a LAN host must tell a client about the map so the client accepts its
// own copy (wisp:docs/lan.md): the path the game names it by, its size, CRC32,
// SHA-1, the xoro checksum of its game files, its playable size and its
// players and forces from war3map.w3i.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { collect } from "../hostProcess";
import { LanFailure } from "./join";
import { decodeMapInfo } from "../../mapInfo";
import { crc32 } from "./w3gs";

/** Flo's checksum step: XOR a little-endian word (or, at the end, a byte) in, then rotate left 3. */
export function xoroUpdate(start: number, bytes: Uint8Array): number {
  let value = start >>> 0;
  const words = bytes.length - (bytes.length % 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rotate = (v: number) => ((v << 3) | (v >>> 29)) >>> 0;
  for (let at = 0; at < words; at += 4) value = rotate(value ^ view.getUint32(at, true));
  for (let at = words; at < bytes.length; at++) value = rotate(value ^ (bytes[at] ?? 0));
  return value;
}

export const SCRIPT_ENTRIES = ["war3map.j", "scripts\\war3map.j", "war3map.lua", "scripts\\war3map.lua"] as const;
/**
 * Files folded in after the script, each as its own checksum. The checked rollback build also
 * folds in war3map.w3l (Reforged's lighting) after war3map.w3q
 * (wc3-slop-lan docs/protocol.md, "The map check").
 */
export const CHECKED_ENTRIES = ["war3map.w3e", "war3map.wpm", "war3map.doo", "war3map.w3u", "war3map.w3b", "war3map.w3d", "war3map.w3a", "war3map.w3q", "war3map.w3l"] as const;

/** The map checksum the client compares, from the archive's entries (undefined: absent). */
export function mapXoro(entry: (name: string) => Uint8Array | undefined): number {
  const script = SCRIPT_ENTRIES.map(entry).find((bytes) => bytes !== undefined);
  if (script === undefined) throw new Error("the map has no war3map.j or war3map.lua");
  let value = xoroUpdate(0, script);
  for (const name of CHECKED_ENTRIES) {
    const bytes = entry(name);
    if (bytes === undefined) continue;
    const word = new Uint8Array(4);
    new DataView(word.buffer).setUint32(0, xoroUpdate(0, bytes), true);
    value = xoroUpdate(value, word);
  }
  return value;
}

export interface MapPlayer {
  readonly id: number;
  /** 1 user, 2 computer, 3 neutral, 4 rescuable. */
  readonly controller: number;
  readonly race: number;
}

export interface MapFacts {
  /** As the game names it in a lobby: `Maps\Folder\Map.w3x`. */
  readonly path: string;
  readonly size: number;
  readonly crc32: number;
  readonly sha1: Uint8Array;
  readonly xoro: number;
  readonly width: number;
  readonly height: number;
  /** The slot table's layout byte: 1 custom forces, plus 2 fixed player settings. */
  readonly layout: number;
  readonly players: readonly MapPlayer[];
  /** Each force's players as a bit per player id. */
  readonly forces: readonly number[];
}

const USE_CUSTOM_FORCES = 0x40;
const FIXED_PLAYER_SETTINGS = 0x20;

/** `Maps\<below the Maps folder>` for a map file under a folder named Maps. */
export function pathInGame(file: string): string {
  const parts = file.split(sep).filter((part) => part !== "");
  const maps = parts.findLastIndex((part) => part.toLowerCase() === "maps");
  if (maps < 0) throw new Error(`${file} is not under a Maps folder`);
  return ["Maps", ...parts.slice(maps + 1)].join("\\");
}

/** Facts from the map's bytes and its extracted entries. */
export function mapFactsFrom(file: Uint8Array, path: string, entry: (name: string) => Uint8Array | undefined): MapFacts {
  const w3i = entry("war3map.w3i");
  if (w3i === undefined) throw new Error("the map has no war3map.w3i");
  const info = decodeMapInfo(w3i);
  const bounds = new DataView(info.bounds.buffer, info.bounds.byteOffset, info.bounds.byteLength);
  return {
    path,
    size: file.length,
    crc32: crc32(file),
    sha1: new Uint8Array(new Bun.CryptoHasher("sha1").update(file).digest()),
    xoro: mapXoro(entry),
    width: bounds.getInt32(48, true),
    height: bounds.getInt32(52, true),
    layout: ((info.flags & USE_CUSTOM_FORCES) !== 0 ? 1 : 0) | ((info.flags & FIXED_PLAYER_SETTINGS) !== 0 ? 2 : 0),
    players: info.players.map(({ id, controller, race }) => ({ id, controller, race })),
    forces: info.forces.map(({ playerMask }) => playerMask),
  };
}

/** Reads a map file's facts, extracting its entries with Wisp's map packager (wisp:native/map-pack.c). */
const read = <A>(run: () => A) => Effect.try({ try: run, catch: cause => new LanFailure({ problem: String(cause) }) });

export const readMapFacts = (mapFile: string, packager: string, path = pathInGame(mapFile)) => Effect.scoped(Effect.gen(function*() {
  const scratch = yield* Effect.acquireRelease(
    read(() => mkdtempSync(join(tmpdir(), "wisp-lan-map."))),
    directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );
  const entries = new Map<string, Uint8Array | undefined>();
  for (const name of [...SCRIPT_ENTRIES, "war3map.w3i", ...CHECKED_ENTRIES]) {
    const out = join(scratch, `${entries.size}`);
    const run = yield* collect(ChildProcess.make(packager, ["extract", mapFile, out, name], { stdout: "ignore", stderr: "ignore" })).pipe(Effect.mapError(cause => new LanFailure({ problem: String(cause) })));
    const bytes = yield* read(() => run.exitCode === 0 && statSync(out, { throwIfNoEntry: false }) !== undefined ? new Uint8Array(readFileSync(out)) : undefined);
    entries.set(name, bytes);
  }
  return yield* read(() => mapFactsFrom(new Uint8Array(readFileSync(mapFile)), path, name => entries.get(name)));
})).pipe(Effect.mapError(cause => new LanFailure({ problem: String(cause) })));
