// The map's Lua VM, read from a client's memory: the call stack of a
// lua_State (its CallInfo chain), each Lua function's chunk name and lines
// from its Proto, and the names of C functions (Warcraft natives such as
// TimerStart) from the globals table. Warcraft III 2.0+ embeds Lua 5.3.4 built
// with 32-bit integers and floats; on x64 its structures have the offsets in
// LUA_53_X64 (lstate.h, lobject.h). A frame's chunk name and line map back to
// TypeScript through the bundle's source map (wisp:scripts/sourceMaps.ts).
import { type Memory, u32, u64 } from "./memory";

/** Lua 5.3.4 structure offsets on x64. */
export const LUA_53_X64 = {
  state: { tt: 8, top: 16, global: 24, ci: 32, baseCi: 96 },
  global: { registry: 64, mainThread: 200 },
  callInfo: { func: 0, previous: 16, savedpc: 40, callstatus: 66 },
  closure: { proto: 24, cFunction: 24 },
  proto: { linedefined: 40, lastlinedefined: 44, sizecode: 24, sizelineinfo: 28, code: 56, lineinfo: 72, source: 104 },
  string: { shortLength: 11, longLength: 16, contents: 24 },
  table: { lsizenode: 11, sizearray: 12, array: 16, node: 24 },
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
  | { readonly kind: "c"; /** The C function's address. */ readonly address: number; /** Its global name, such as TimerStart, when it has one. */ readonly name: string | undefined };

/** The line `savedpc` is at in a Lua function: lineinfo[pc - 1]. */
function currentLine(memory: Memory, proto: number, savedpc: number): number | undefined {
  const p = LUA_53_X64.proto;
  const code = u64(memory, proto + p.code);
  const index = (savedpc - code) / 4 - 1;
  const size = u32(memory, proto + p.sizelineinfo);
  if (!Number.isInteger(index) || index < 0 || index >= size) return undefined;
  return memory.read(u64(memory, proto + p.lineinfo) + index * 4, 4).readInt32LE(0);
}

/** C functions in _G by address: Warcraft's natives and Lua's own library functions. */
export function globalFunctionNames(memory: Memory, state: number): Map<number, string> {
  const names = new Map<number, string>();
  const global = u64(memory, state + LUA_53_X64.state.global);
  const registry = readValue(memory, global + LUA_53_X64.global.registry);
  if (registry.tag !== (LUA_TAG.table & 0x7f)) return names;
  const t = LUA_53_X64.table;
  const globals = readValue(memory, u64(memory, registry.value + t.array) + (RIDX_GLOBALS - 1) * TVALUE);
  if (globals.tag !== (LUA_TAG.table & 0x7f)) return names;
  const size = 1 << memory.read(globals.value + t.lsizenode, 1).readUInt8(0);
  const nodes = memory.read(u64(memory, globals.value + t.node), size * NODE);
  for (let index = 0; index < size; index++) {
    const at = index * NODE;
    const valueTag = nodes.readUInt32LE(at + 8) & 0x7f;
    const keyTag = nodes.readUInt32LE(at + TVALUE + 8) & 0x7f;
    if (keyTag !== LUA_TAG.shortString && keyTag !== LUA_TAG.longString) continue;
    const value = Number(nodes.readBigUInt64LE(at));
    let address: number | undefined;
    if (valueTag === LUA_TAG.lightC) address = value;
    else if (valueTag === LUA_TAG.cClosure) address = u64(memory, value + LUA_53_X64.closure.cFunction);
    if (address === undefined) continue;
    try {
      names.set(address, readString(memory, Number(nodes.readBigUInt64LE(at + TVALUE))));
    } catch {
      // A key we can't read names nothing.
    }
  }
  return names;
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
      const address = func.tag === LUA_TAG.lightC ? func.value : u64(memory, func.value + LUA_53_X64.closure.cFunction);
      frames.push({ kind: "c", address, name: names.get(address) });
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
