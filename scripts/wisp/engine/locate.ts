// Finding the presence table in a client of any build: `wisp engine locate`
// prints the result, and the poller uses it for a build offsets.json doesn't
// list yet, so a new Warcraft build is readable in the same session that
// locates it (wisp:docs/engine.md#a-new-warcraft-build).
import type { GameExecutable, Mapping, Memory } from "./memory";
import type { EngineOffsets } from "./offsets";
import { type PresenceScan, presenceScanFailure, scanForPresenceTable } from "./presence";

export interface LocateTarget {
  readonly memory: Memory;
  readonly maps: readonly Mapping[];
  readonly base: number;
  readonly exe: GameExecutable;
}

/** Bytes of .data scanned for the table pointer by default. */
export const LOCATE_SPAN = 0x4000000;

export interface Location {
  /** The layout scanned with: the build's own entry, or the newest known one. */
  readonly layout: EngineOffsets;
  readonly existing: EngineOffsets | undefined;
  readonly scan: PresenceScan;
  /** The build's entry with the table found, when exactly one table matched. */
  readonly offsets: EngineOffsets | undefined;
  /** Why no entry was derived. */
  readonly problem: string | undefined;
}

/** Scans `target`'s .data for the presence table in its build's layout, or the newest known layout for a new build. */
export function locatePresence(target: LocateTarget, known: ReadonlyMap<string, EngineOffsets>, span = LOCATE_SPAN): Location | string {
  const existing = known.get(target.exe.version);
  // A new build starts with the newest known layout; a map must initialize the table before it can match.
  const layout = existing ?? [...known.values()].at(-1);
  if (layout === undefined) return "the offsets file has no entry to take the table layout from";
  const data = target.exe.header.sections.find(({ name }) => name === ".data");
  if (data === undefined) return `${target.exe.path} has no .data section`;
  const scan = scanForPresenceTable(target.memory, target.maps, target.base, data.rva, Math.min(data.virtualSize, span), { ...layout, sizeOfImage: target.exe.header.sizeOfImage });
  const tables = new Set(scan.candidates.map(({ table }) => table));
  const [first] = scan.candidates;
  if (first === undefined) return { layout, existing, scan, offsets: undefined, problem: presenceScanFailure(scan) };
  if (tables.size > 1) return { layout, existing, scan, offsets: undefined, problem: `${tables.size} different tables match; check them by hand` };
  const { lua: _lua, ...shape } = layout;
  const offsets: EngineOffsets = {
    ...shape,
    version: target.exe.version,
    sizeOfImage: target.exe.header.sizeOfImage,
    presenceTable: first.rva,
    roles: new Map(existing?.roles ?? []),
    ...(existing?.lua === undefined ? {} : { lua: existing.lua }),
  };
  return { layout, existing, scan, offsets, problem: undefined };
}
