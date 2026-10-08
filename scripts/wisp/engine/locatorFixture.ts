// A build's locator fixture: what `wisp engine locate --out FILE` measured on
// a running client (the scan's signature checks, the table it found, the
// map's Lua VM) and the few hundred bytes of memory those checks read. Tests
// replay the bytes against offsets.json, so a changed check or layout names
// the signature it breaks; after a Warcraft update, the new build's failed
// checks compare against the last build's counts (wisp:docs/engine.md).
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import type { LuaGlobals } from "./lua";
import { type Mapping, type Memory, readableAt } from "./memory";
import type { EngineOffsets } from "./offsets";
import { type PresenceCandidate, type PresencePattern, checkPresenceTable } from "./presence";
import type { LocateTarget, Location } from "./locate";

const Hex = Schema.String.check(Schema.isPattern(/^0x[0-9a-f]+$/));

const FixtureFile = Schema.Struct({
  version: Schema.String,
  sizeOfImage: Hex,
  timeDateStamp: Schema.Finite,
  data: Schema.Struct({ rva: Hex, virtualSize: Hex }),
  base: Hex,
  scan: Schema.Struct({
    scannedBytes: Schema.Finite,
    rejected: Schema.Record(Schema.String, Schema.Finite),
    candidates: Schema.Array(Schema.Struct({ rva: Hex, table: Hex, count: Schema.Finite, freeHead: Schema.Finite, births: Schema.Finite, sampled: Schema.Finite, matching: Schema.Finite })),
  }),
  lua: Schema.Array(Schema.Struct({ state: Hex, natives: Schema.Finite, chunks: Schema.Record(Schema.String, Schema.Finite) })),
  /** Memory the presence checks read, as base64 at each start address. */
  regions: Schema.Array(Schema.Struct({ start: Hex, bytes: Schema.String })),
});

export type LocatorFixture = typeof FixtureFile.Type;

const h = (value: number) => `0x${value.toString(16)}`;
const hex = (text: string) => Number.parseInt(text, 16);

/** Each entry slot read per candidate, as checkPresenceTable samples them. */
const SAMPLE = 256;
const ENTRY = 16;

/** The address ranges checkPresenceTable reads for `candidate`, plus its pointer slot. */
function candidateRanges(memory: Memory, maps: readonly Mapping[], base: number, candidate: PresenceCandidate, layout: EngineOffsets): [number, number][] {
  const { entries, count, freeHead, births } = layout.table;
  const ranges: [number, number][] = [
    [base + candidate.rva, 8],
    [candidate.table, Math.max(entries + 8, count + 4, freeHead + 4, births + 4)],
  ];
  const sample = Math.min(candidate.header.count, SAMPLE);
  ranges.push([candidate.header.entries, sample * ENTRY]);
  let slots: Buffer;
  try {
    slots = memory.read(candidate.header.entries, sample * ENTRY);
  } catch {
    return ranges;
  }
  for (let tag = 0; tag < sample; tag++) {
    const object = Number(slots.readBigUInt64LE(tag * ENTRY + 8));
    if (slots.readInt32LE(tag * ENTRY) === -2 && readableAt(maps, object)) ranges.push([object, Math.max(layout.agent.tag, layout.agent.birth) + 4]);
  }
  return ranges;
}

export type LuaSummary = readonly { readonly state: number; readonly globals: LuaGlobals }[];

/**
 * The fixture for a locate run on `target`: its checks, its table and the
 * bytes they read. Take it right after the scan: a running game grows its
 * table and moves the entries, so each candidate is checked again here and
 * its bytes read at once.
 */
export function captureFixture(target: LocateTarget, location: Location): LocatorFixture {
  const layout = { ...location.layout, sizeOfImage: target.exe.header.sizeOfImage };
  const candidates = location.scan.candidates.map((candidate) => {
    const now = checkPresenceTable(target.memory, target.maps, candidate.table, layout);
    return typeof now === "string" ? candidate : { ...now, rva: candidate.rva };
  });
  const ranges = candidates.flatMap((candidate) => candidateRanges(target.memory, target.maps, target.base, candidate, layout)).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [start, length] of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && start < last[0] + last[1]) last[1] = Math.max(last[1], start + length - last[0]);
    else merged.push([start, length]);
  }
  const regions = merged.flatMap(([start, length]) => {
    try {
      return [{ start: h(start), bytes: target.memory.read(start, length).toString("base64") }];
    } catch {
      return [];
    }
  });
  const data = target.exe.header.sections.find(({ name }) => name === ".data");
  return {
    version: target.exe.version,
    sizeOfImage: h(target.exe.header.sizeOfImage),
    timeDateStamp: target.exe.header.timeDateStamp,
    data: { rva: h(data?.rva ?? 0), virtualSize: h(data?.virtualSize ?? 0) },
    base: h(target.base),
    scan: {
      scannedBytes: location.scan.scannedBytes,
      rejected: Object.fromEntries(location.scan.rejected),
      candidates: candidates.map(({ rva, table, header, sampled, matching }) => ({ rva: h(rva), table: h(table), count: header.count, freeHead: header.freeHead, births: header.births, sampled, matching })),
    },
    lua: [],
    regions,
  };
}

/** The fixture with the Lua VMs locate found. */
export const withLua = (fixture: LocatorFixture, lua: LuaSummary): LocatorFixture => ({
  ...fixture,
  lua: lua.map(({ state, globals }) => ({ state: h(state), natives: globals.natives, chunks: Object.fromEntries(globals.chunks) })),
});

export const parseFixture = (text: string): LocatorFixture => Schema.decodeUnknownSync(FixtureFile)(JSON.parse(text));

export const readFixture = (path: string) => parseFixture(readFileSync(path, "utf8"));

/** The fixture's recorded memory, readable where it was captured and nowhere else. */
export function fixtureMemory(fixture: LocatorFixture): { readonly memory: Memory; readonly maps: Mapping[] } {
  const regions = fixture.regions.map(({ start, bytes }) => ({ start: hex(start), bytes: Buffer.from(bytes, "base64") }));
  const memory: Memory = {
    read: (address, length) => {
      const region = regions.find(({ start, bytes }) => address >= start && address + length <= start + bytes.length);
      if (region === undefined) throw new Error(`0x${address.toString(16)} (+${length}) is not in the fixture`);
      return Buffer.from(region.bytes.subarray(address - region.start, address - region.start + length));
    },
  };
  const maps = regions.map(({ start, bytes }) => ({ start, end: start + bytes.length, permissions: "rw-p", offset: 0, path: "" })).sort((x, y) => x.start - y.start);
  return { memory, maps };
}

/** Each recorded candidate checked again in `layout`: the candidate, or the first signature check it now fails. */
export function replayFixture(fixture: LocatorFixture, layout: EngineOffsets): (Omit<PresenceCandidate, "rva"> | PresencePattern)[] {
  const { memory, maps } = fixtureMemory(fixture);
  return fixture.scan.candidates.map(({ table }) => checkPresenceTable(memory, maps, hex(table), { ...layout, sizeOfImage: hex(fixture.sizeOfImage) }));
}
