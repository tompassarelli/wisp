// Tempest's presence table, read from a running client. Every agent (a
// CAgentBaseAbs owned by a Jass/Lua handle such as a timer or a code
// callback, and Ipse objects such as CPoFlag) holds a tag in it; the table's
// free-list head and birth counter are Desync.txt's "next presence tag" and
// "next birth tag", and the tempest checksum covers its live entries. Two
// clients that make or free an agent on different turns desync
// (wisp:docs/engine.md).
import type { EngineOffsets } from "./offsets";
import { scriptFuncDefinition } from "./lua";
import { type Mapping, type Memory, readableAt, u32, u64 } from "./memory";

/** `.?AVCPoFlag@NIpse@@` → `NIpse::CPoFlag`; anything else is returned as read. */
export function demangle(name: string): string {
  const match = /^\.\?A[VU](.+)@@$/.exec(name);
  if (match === null || (match[1] ?? "").includes("?")) return name;
  return (match[1] ?? "").split("@").reverse().join("::");
}

/** Class names by vtable address, read from MSVC x64 RTTI: vtable[-1] → complete object locator → type descriptor. */
export class ClassNames {
  private readonly names = new Map<number, string | undefined>();
  constructor(private readonly memory: Memory, private readonly base: number) {}

  /** The class of the object at `object`, or undefined when it has no RTTI there. */
  of(object: number): string | undefined {
    let vtable: number;
    try {
      vtable = u64(this.memory, object);
    } catch {
      return undefined;
    }
    if (this.names.has(vtable)) return this.names.get(vtable);
    let name: string | undefined;
    try {
      const locator = u64(this.memory, vtable - 8);
      // An x64 complete object locator has signature 1 and image-relative offsets.
      if (u32(this.memory, locator) === 1) {
        const descriptor = this.base + u32(this.memory, locator + 12);
        const text = this.memory.read(descriptor + 16, 128).toString("latin1").split("\0")[0] ?? "";
        if (text.startsWith(".?A")) name = demangle(text);
      }
    } catch {
      name = undefined;
    }
    this.names.set(vtable, name);
    return name;
  }
}

export interface PresenceHeader {
  readonly entries: number;
  readonly count: number;
  readonly freeHead: number;
  readonly births: number;
}

export function readHeader(memory: Memory, table: number, offsets: EngineOffsets): PresenceHeader {
  const { entries, count, freeHead, births } = offsets.table;
  const bytes = memory.read(table, Math.max(entries + 8, count + 4, freeHead + 4, births + 4));
  return {
    entries: Number(bytes.readBigUInt64LE(entries)),
    count: bytes.readUInt32LE(count),
    freeHead: bytes.readInt32LE(freeHead),
    births: bytes.readUInt32LE(births),
  };
}

/** The table's address: the pointer at its RVA. */
export const presenceTable = (memory: Memory, base: number, offsets: EngineOffsets) => u64(memory, base + offsets.presenceTable);

/** A live entry's state word; a free entry holds the next free index instead. */
const LIVE = -2;
const ENTRY = 16;

export interface Agent {
  readonly tag: number;
  readonly object: number;
  readonly birth: number;
  readonly className: string;
  /** For a CAgentBaseAbs: the class of the handle object it points back to, when one is found. */
  readonly owner: string | undefined;
  /** For a code callback (owner CScriptFunc): where its Lua function was defined, `map-KEY:LINE`. */
  readonly defined?: string;
}

export type PresenceEvent =
  | { readonly kind: "born"; readonly agent: Agent }
  | { readonly kind: "freed"; readonly agent: Agent };

/** The handle object an agent points back to (a timer, a code callback) and its class, when it has RTTI. */
export function ownerOf(memory: Memory, names: ClassNames, object: number, offsets: EngineOffsets): { readonly address: number; readonly className: string } | undefined {
  try {
    const address = u64(memory, object + offsets.agent.owner);
    const className = address === 0 || address === object ? undefined : names.of(address);
    return className === undefined ? undefined : { address, className };
  } catch {
    return undefined;
  }
}

/**
 * Follows one client's presence table: `poll` reads the header and, when it
 * changed, every entry, and returns the agents born and freed since the last
 * poll, in birth order.
 */
export class PresenceTracker {
  private header: PresenceHeader | undefined;
  private readonly agents = new Map<number, Agent>();
  private readonly names: ClassNames;

  constructor(private readonly memory: Memory, private readonly base: number, private readonly offsets: EngineOffsets) {
    this.names = new ClassNames(memory, base);
  }

  /** The agents now live, by tag. */
  live(): ReadonlyMap<number, Agent> {
    return this.agents;
  }

  current(): PresenceHeader | undefined {
    return this.header;
  }

  private describe(tag: number, object: number): Agent {
    let birth = -1;
    try {
      birth = this.memory.read(object + this.offsets.agent.birth, 4).readInt32LE(0);
    } catch {
      birth = -1;
    }
    const className = this.names.of(object) ?? "?";
    const owner = className === "CAgentBaseAbs" ? ownerOf(this.memory, this.names, object, this.offsets) : undefined;
    const defined = owner?.className === "CScriptFunc" ? scriptFuncDefinition(this.memory, owner.address, this.offsets.lua?.closure) : undefined;
    return { tag, object, birth, className, owner: owner?.className, ...(defined === undefined ? {} : { defined }) };
  }

  /** Born and freed agents since the previous poll; the first poll records the table and returns none. */
  poll(): PresenceEvent[] {
    const table = presenceTable(this.memory, this.base, this.offsets);
    const header = readHeader(this.memory, table, this.offsets);
    const previous = this.header;
    if (previous !== undefined && previous.count === header.count && previous.freeHead === header.freeHead && previous.births === header.births && previous.entries === header.entries) return [];
    this.header = header;
    const entries = header.count === 0 ? Buffer.alloc(0) : this.memory.read(header.entries, header.count * ENTRY);
    const events: PresenceEvent[] = [];
    const seen = new Set<number>();
    for (let tag = 0; tag < header.count; tag++) {
      const state = entries.readInt32LE(tag * ENTRY);
      const object = Number(entries.readBigUInt64LE(tag * ENTRY + 8));
      const known = this.agents.get(tag);
      if (state !== LIVE || object === 0) {
        if (known !== undefined) {
          this.agents.delete(tag);
          events.push({ kind: "freed", agent: known });
        }
        continue;
      }
      seen.add(tag);
      if (known !== undefined && known.object === object) continue;
      if (known !== undefined) events.push({ kind: "freed", agent: known });
      const agent = this.describe(tag, object);
      this.agents.set(tag, agent);
      if (previous !== undefined) events.push({ kind: "born", agent });
    }
    for (const [tag, agent] of this.agents) {
      if (tag >= header.count && !seen.has(tag)) {
        this.agents.delete(tag);
        events.push({ kind: "freed", agent });
      }
    }
    return events.sort((x, y) => x.agent.birth - y.agent.birth || (x.kind === y.kind ? 0 : x.kind === "freed" ? -1 : 1));
  }
}

export interface PresenceCandidate {
  /** The pointer's RVA in the image. */
  readonly rva: number;
  readonly table: number;
  readonly header: PresenceHeader;
  /** Live entries sampled, and how many of them held their own tag. */
  readonly sampled: number;
  readonly matching: number;
}

/**
 * Finds the presence table without knowing where it is: every pointer in the
 * image's writable data from `start` for `span` bytes that leads to a header
 * in `layout`'s shape whose live entries are agents holding their own tags.
 */
export function scanForPresenceTable(memory: Memory, maps: readonly Mapping[], base: number, start: number, span: number, layout: EngineOffsets): PresenceCandidate[] {
  const found: PresenceCandidate[] = [];
  const CHUNK = 0x100000;
  const imageEnd = base + layout.sizeOfImage;
  for (let offset = 0; offset < span; offset += CHUNK) {
    const length = Math.min(CHUNK, span - offset);
    let chunk: Buffer;
    try {
      chunk = memory.read(base + start + offset, length);
    } catch {
      continue;
    }
    for (let at = 0; at + 8 <= chunk.length; at += 8) {
      const table = Number(chunk.readBigUInt64LE(at));
      if (table % 8 !== 0 || (table >= base && table < imageEnd) || !readableAt(maps, table)) continue;
      const candidate = checkPresenceTable(memory, maps, table, layout);
      if (candidate !== undefined) found.push({ ...candidate, rva: start + offset + at });
    }
  }
  return found;
}

/** `table` as a presence table in `layout`'s shape, or undefined when it isn't one. */
export function checkPresenceTable(memory: Memory, maps: readonly Mapping[], table: number, layout: EngineOffsets): Omit<PresenceCandidate, "rva"> | undefined {
  let header: PresenceHeader;
  try {
    header = readHeader(memory, table, layout);
  } catch {
    return undefined;
  }
  if (header.count < 16 || header.count > 1 << 22 || header.births < header.count || header.freeHead < -1 || header.freeHead >= header.count) return undefined;
  if (!readableAt(maps, header.entries)) return undefined;
  const sample = Math.min(header.count, 256);
  let entries: Buffer;
  try {
    entries = memory.read(header.entries, sample * ENTRY);
  } catch {
    return undefined;
  }
  let sampled = 0;
  let matching = 0;
  for (let tag = 0; tag < sample; tag++) {
    if (entries.readInt32LE(tag * ENTRY) !== LIVE) continue;
    const object = Number(entries.readBigUInt64LE(tag * ENTRY + 8));
    if (!readableAt(maps, object)) continue;
    sampled++;
    try {
      const agent = memory.read(object + layout.agent.tag, layout.agent.birth - layout.agent.tag + 4);
      const birth = agent.readInt32LE(layout.agent.birth - layout.agent.tag);
      if (agent.readUInt32LE(0) === tag && birth >= 0 && birth < header.births) matching++;
    } catch {
      // An unreadable agent counts against the candidate.
    }
  }
  return sampled >= 8 && matching >= sampled * 0.9 ? { table, header, sampled, matching } : undefined;
}
