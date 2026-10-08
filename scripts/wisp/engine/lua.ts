// The map's Lua VM, read from a client's memory: the call stack of a
// lua_State (its CallInfo chain), each Lua function's chunk name and lines
// from its Proto, and the names of C functions (Warcraft natives such as
// TimerStart) from the globals table. Warcraft III 2.0+ embeds Lua 5.3.4 built
// with 32-bit integers and floats; on x64 its structures have the offsets in
// LUA_53_X64 (lstate.h, lobject.h). A frame's chunk name and line map back to
// TypeScript through the bundle's source map (wisp:scripts/sourceMaps.ts).
import { type Memory, u32, u64 } from "./memory";

/**
 * Warcraft III's Lua 5.3.4 structure offsets on x64. Its collectable objects
 * have a 16-byte header (Lua's is 10 bytes), so every object's fields start 8
 * bytes later than in stock Lua; CallInfo and TValue are unchanged. Measured
 * on 3.0.0.24268.
 */
export const LUA_53_X64 = {
  state: { tt: 8, top: 0x18, global: 0x20, ci: 0x28, baseCi: 0x68 },
  global: { registry: 0x40, mainThread: 0xd0, version: 0xd8 },
  callInfo: { func: 0, previous: 16, savedpc: 40, callstatus: 66 },
  closure: { proto: 0x20, cFunction: 0x20 },
  proto: { linedefined: 0x2c, lastlinedefined: 0x30, sizecode: 0x1c, sizelineinfo: 0x20, code: 0x40, lineinfo: 0x50, source: 0x70 },
  string: { shortLength: 0x11, longLength: 0x18, contents: 0x20 },
  table: { lsizenode: 0x11, sizearray: 0x14, array: 0x18, node: 0x20 },
} as const;

/** Type tags (lobject.h), with the collectable bit where the value is a GC object. */
export const LUA_TAG = {
  thread: 8,
  luaClosure: 0x46,
  lightC: 0x16,
  cClosure: 0x66,
  table: 0x45,
  shortString: 0x44,
  longString: 0x54,
} as const;

const CIST_LUA = 1 << 1;
const TVALUE = 16;
const NODE = 32;
/** LUA_RIDX_GLOBALS: the registry's array slot (1-based) that holds _G. */
const RIDX_GLOBALS = 2;

/** A TValue's tag and payload. */
export function readValue(memory: Memory, address: number): { readonly tag: number; readonly value: number } {
  const bytes = memory.read(address, TVALUE);
  return { tag: bytes.readUInt32LE(8) & 0x7f, value: Number(bytes.readBigUInt64LE(0)) };
}

/** A TString's text. */
export function readString(memory: Memory, address: number): string {
  const tag = memory.read(address + 8, 1).readUInt8(0) & 0x7f;
  const short = tag === (LUA_TAG.shortString & 0x3f) || tag === LUA_TAG.shortString;
  const length = short ? memory.read(address + LUA_53_X64.string.shortLength, 1).readUInt8(0) : u64(memory, address + LUA_53_X64.string.longLength);
  return memory.read(address + LUA_53_X64.string.contents, Math.min(length, 4096)).toString("latin1");
}

/** Whether `state` is a lua_State whose global state names it, or another thread of it. */
export function isLuaState(memory: Memory, state: number): boolean {
  try {
    if ((memory.read(state + LUA_53_X64.state.tt, 1).readUInt8(0) & 0x3f) !== LUA_TAG.thread) return false;
    const global = u64(memory, state + LUA_53_X64.state.global);
    const main = u64(memory, global + LUA_53_X64.global.mainThread);
    return main === state || (memory.read(main + LUA_53_X64.state.tt, 1).readUInt8(0) & 0x3f) === LUA_TAG.thread && u64(memory, main + LUA_53_X64.state.global) === global;
  } catch {
    return false;
  }
}

export interface LuaFunction {
  /** The chunk name: for a Wisp map, `map-KEY` or `hot-KEY` (a leading `@` or `=` removed). */
  readonly source: string;
  readonly linedefined: number;
  readonly lastlinedefined: number;
}

/** A Lua closure's function: its chunk and lines. */
export function closureFunction(memory: Memory, closure: number): LuaFunction {
  const proto = u64(memory, closure + LUA_53_X64.closure.proto);
  const p = LUA_53_X64.proto;
  return {
    source: readString(memory, u64(memory, proto + p.source)).replace(/^[@=]/, ""),
    linedefined: memory.read(proto + p.linedefined, 4).readInt32LE(0),
    lastlinedefined: memory.read(proto + p.lastlinedefined, 4).readInt32LE(0),
  };
}

export type LuaFrame =
  | { readonly kind: "lua"; readonly function: LuaFunction; /** The line running, from savedpc; undefined when unreadable. */ readonly line: number | undefined }
  | { readonly kind: "c"; /** The C closure's address, or a light C function's. */ readonly address: number; /** Its global name, such as TimerStart, when it has one. */ readonly name: string | undefined };

/** The line `savedpc` is at in a Lua function: lineinfo[pc - 1]. */
function currentLine(memory: Memory, proto: number, savedpc: number): number | undefined {
  const p = LUA_53_X64.proto;
  const code = u64(memory, proto + p.code);
  const index = (savedpc - code) / 4 - 1;
  const size = u32(memory, proto + p.sizelineinfo);
  if (!Number.isInteger(index) || index < 0 || index >= size) return undefined;
  return memory.read(u64(memory, proto + p.lineinfo) + index * 4, 4).readInt32LE(0);
}

interface HashEntry {
  readonly keyTag: number;
  readonly key: number;
  readonly valueTag: number;
  readonly value: number;
}

/** A table's hash part: each node's key and value tags and payloads. */
function hashEntries(memory: Memory, table: number): HashEntry[] {
  const t = LUA_53_X64.table;
  const log = memory.read(table + t.lsizenode, 1).readUInt8(0);
  // Over a million nodes is not a table this reader needs; it would be 32+ MiB of reads.
  if (log > 20) return [];
  const size = 1 << log;
  const nodes = memory.read(u64(memory, table + t.node), size * NODE);
  const entries: HashEntry[] = [];
  for (let index = 0; index < size; index++) {
    const at = index * NODE;
    entries.push({
      valueTag: nodes.readUInt32LE(at + 8) & 0x7f,
      value: Number(nodes.readBigUInt64LE(at)),
      keyTag: nodes.readUInt32LE(at + TVALUE + 8) & 0x7f,
      key: Number(nodes.readBigUInt64LE(at + TVALUE)),
    });
  }
  return entries;
}

/** `state`'s _G table: the registry's array slot LUA_RIDX_GLOBALS, or undefined when it isn't a table. */
function globalsTable(memory: Memory, state: number): number | undefined {
  const global = u64(memory, state + LUA_53_X64.state.global);
  const registry = readValue(memory, global + LUA_53_X64.global.registry);
  if (registry.tag !== (LUA_TAG.table & 0x7f)) return undefined;
  const globals = readValue(memory, u64(memory, registry.value + LUA_53_X64.table.array) + (RIDX_GLOBALS - 1) * TVALUE);
  return globals.tag === (LUA_TAG.table & 0x7f) ? globals.value : undefined;
}

const isStringKey = (tag: number) => tag === LUA_TAG.shortString || tag === LUA_TAG.longString;

/**
 * C functions in _G, keyed by what a call frame holds: a C closure's object
 * address (Warcraft's natives are C closures sharing one dispatcher, told
 * apart by their upvalues) or a light C function's address.
 */
export function globalFunctionNames(memory: Memory, state: number): Map<number, string> {
  const names = new Map<number, string>();
  const globals = globalsTable(memory, state);
  if (globals === undefined) return names;
  for (const { keyTag, key, valueTag, value } of hashEntries(memory, globals)) {
    if (!isStringKey(keyTag) || (valueTag !== LUA_TAG.lightC && valueTag !== LUA_TAG.cClosure)) continue;
    try {
      names.set(value, readString(memory, key));
    } catch {
      // A key we can't read names nothing.
    }
  }
  return names;
}

export interface LuaGlobals {
  /** C functions in _G: Warcraft's natives. */
  readonly natives: number;
  /** Lua functions in _G and in tables _G holds, counted by chunk name (`map-KEY` for a Wisp map's bundle). */
  readonly chunks: ReadonlyMap<string, number>;
}

/** What a VM's globals hold: its natives, and where its Lua functions come from, which tells the map's VM from another. */
export function luaGlobals(memory: Memory, state: number): LuaGlobals {
  const globals = globalsTable(memory, state);
  const chunks = new Map<string, number>();
  let natives = 0;
  if (globals === undefined) return { natives, chunks };
  const count = (closure: number) => {
    try {
      const { source } = closureFunction(memory, closure);
      chunks.set(source, (chunks.get(source) ?? 0) + 1);
    } catch {
      // An unreadable function counts toward nothing.
    }
  };
  for (const { keyTag, valueTag, value } of hashEntries(memory, globals)) {
    if (!isStringKey(keyTag)) continue;
    if (valueTag === LUA_TAG.lightC || valueTag === LUA_TAG.cClosure) natives++;
    else if (valueTag === LUA_TAG.luaClosure) count(value);
    else if (valueTag === (LUA_TAG.table & 0x7f) && value !== globals) {
      try {
        for (const inner of hashEntries(memory, value)) if (inner.valueTag === LUA_TAG.luaClosure) count(inner.value);
      } catch {
        // A table we can't read adds nothing.
      }
    }
  }
  return { natives, chunks };
}

/** The stack of `state`, innermost call first, down to its base CallInfo. */
export function luaStack(memory: Memory, state: number, names: ReadonlyMap<number, string> = new Map(), limit = 64): LuaFrame[] {
  const c = LUA_53_X64.callInfo;
  const base = state + LUA_53_X64.state.baseCi;
  const frames: LuaFrame[] = [];
  for (let ci = u64(memory, state + LUA_53_X64.state.ci); ci !== 0 && ci !== base && frames.length < limit; ci = u64(memory, ci + c.previous)) {
    const func = readValue(memory, u64(memory, ci + c.func));
    const status = memory.read(ci + c.callstatus, 2).readUInt16LE(0);
    if (func.tag === LUA_TAG.luaClosure && (status & CIST_LUA) !== 0) {
      const proto = u64(memory, func.value + LUA_53_X64.closure.proto);
      let line: number | undefined;
      try {
        line = currentLine(memory, proto, u64(memory, ci + c.savedpc));
      } catch {
        line = undefined;
      }
      frames.push({ kind: "lua", function: closureFunction(memory, func.value), line });
    } else if (func.tag === LUA_TAG.lightC || func.tag === LUA_TAG.cClosure) {
      frames.push({ kind: "c", address: func.value, name: names.get(func.value) });
    }
  }
  return frames;
}

/** `TimerStart`, or `map-KEY:150 (function at 148)`; positions map to TypeScript with toTypeScript. */
export function frameText(frame: LuaFrame): string {
  if (frame.kind === "c") return frame.name ?? `C 0x${frame.address.toString(16)}`;
  const { source, linedefined } = frame.function;
  return `${source}:${frame.line ?? linedefined}${frame.line === undefined ? "" : ` (function at ${source}:${linedefined})`}`;
}

/** Follows a pointer chain: from `start`, each offset is added and the pointer there read. */
export function followChain(memory: Memory, start: number, chain: readonly number[]): number {
  let address = start;
  for (const offset of chain) address = u64(memory, address + offset);
  return address;
}

/** The map's main lua_State through the offsets' chain, or undefined when no map runs (or the chain is unknown). */
export function mainLuaState(memory: Memory, base: number, chain: readonly number[] | undefined): number | undefined {
  if (chain === undefined) return undefined;
  try {
    const state = followChain(memory, base, chain);
    return isLuaState(memory, state) ? state : undefined;
  } catch {
    return undefined;
  }
}

/** Where a CScriptFunc's Lua function was defined, `map-KEY:LINE`, through the offsets' chain. */
export function scriptFuncDefinition(memory: Memory, scriptFunc: number, chain: readonly number[] | undefined): string | undefined {
  if (chain === undefined) return undefined;
  try {
    const closure = followChain(memory, scriptFunc, chain);
    if ((memory.read(closure + 8, 1).readUInt8(0) & 0x3f) !== (LUA_TAG.luaClosure & 0x3f)) return undefined;
    const fn = closureFunction(memory, closure);
    return `${fn.source}:${fn.linedefined}`;
  } catch {
    return undefined;
  }
}

/**
 * Every main lua_State in the process, found by signature: a global state's
 * `version` points to the float 503 (Lua 5.3, 32-bit numbers), and the main
 * thread before it is a thread whose global state is that one. Scans the
 * writable anonymous mappings (4.6 GiB on a 3.0.1 client). With `image`, the
 * executable's range, it first takes only `version` pointers into the image,
 * where Warcraft's statically linked Lua keeps that float, reading each such
 * address once; the whole scan runs only when that finds nothing.
 */
export function findLuaStates(memory: Memory, maps: readonly { start: number; end: number; permissions: string; path: string }[], image?: { readonly start: number; readonly end: number }): number[] {
  if (image !== undefined) {
    const found = scanLuaStates(memory, maps, image);
    if (found.length > 0) return found;
  }
  return scanLuaStates(memory, maps, undefined);
}

function scanLuaStates(memory: Memory, maps: readonly { start: number; end: number; permissions: string; path: string }[], image: { readonly start: number; readonly end: number } | undefined): number[] {
  const g = LUA_53_X64.global;
  const found = new Set<number>();
  const is503 = new Map<number, boolean>();
  const floatIs503 = (address: number) => {
    let known = is503.get(address);
    if (known === undefined) {
      try {
        known = memory.read(address, 4).readFloatLE(0) === 503;
      } catch {
        known = false;
      }
      if (image !== undefined) is503.set(address, known);
    }
    return known;
  };
  const low = image?.start ?? 0x10000;
  const high = image?.end ?? 0x800000000000;
  for (const mapping of maps) {
    if (!mapping.permissions.startsWith("rw") || mapping.path.includes("wine-mapping") || mapping.end - mapping.start > 0x40000000) continue;
    for (let at = mapping.start; at < mapping.end; at += 0x100000) {
      let chunk: Buffer;
      try {
        chunk = memory.read(at, Math.min(0x100000, mapping.end - at));
      } catch {
        continue;
      }
      const words = new Uint32Array(chunk.buffer, chunk.byteOffset, chunk.length >> 2);
      for (let i = g.version - g.mainThread; i + 8 <= chunk.length; i += 8) {
        const version = (words[(i >> 2) + 1] ?? 0) * 0x100000000 + (words[i >> 2] ?? 0);
        if (version < low || version >= high || !floatIs503(version)) continue;
        try {
          const global = at + i - g.version;
          const state = Number(chunk.readBigUInt64LE(i - (g.version - g.mainThread)));
          if (u64(memory, state + LUA_53_X64.state.global) === global && isLuaState(memory, state)) found.add(state);
        } catch {
          // Not a global state.
        }
      }
    }
  }
  return [...found];
}

/** Every thread (coroutine) of `state`'s VM: objects tagged as threads whose global state is its. */
export function findLuaThreads(memory: Memory, maps: readonly { start: number; end: number; permissions: string; path: string }[], state: number): number[] {
  const global = BigInt(u64(memory, state + LUA_53_X64.state.global));
  const threads: number[] = [];
  for (const mapping of maps) {
    if (!mapping.permissions.startsWith("rw") || mapping.path.includes("wine-mapping") || mapping.end - mapping.start > 0x40000000) continue;
    for (let at = mapping.start; at < mapping.end; at += 0x100000) {
      let chunk: Buffer;
      try {
        chunk = memory.read(at, Math.min(0x100000, mapping.end - at));
      } catch {
        continue;
      }
      for (let i = 0; i + LUA_53_X64.state.ci + 8 <= chunk.length; i += 8) {
        if (chunk[i + LUA_53_X64.state.tt] === LUA_TAG.thread && chunk.readBigUInt64LE(i + LUA_53_X64.state.global) === global) threads.push(at + i);
      }
    }
  }
  return threads;
}
