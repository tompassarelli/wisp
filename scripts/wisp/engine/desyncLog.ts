// Warcraft's per-turn state dump: on a network desync each client appends
// the last three turns of every checksum section to Errors/<report>/<host>_<session>_Desync.log
// (wisp:docs/engine.md). Comparing two clients' dumps names the section that
// diverged first; for Tempest's `ipse` section it also decodes the presence
// table's free head and birth counter.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DesyncRecord {
  /** Nested record ids from the section down, FourCC when printable, such as `#1` or `plat/#1886157178`. */
  readonly path: string;
  /** `0x…` for a value; undefined for a line that opens a group. */
  readonly value: string | undefined;
}

export interface DesyncBlock {
  /** The section's FourCC, such as `ipse` (Tempest), `rand` or `cust`. */
  readonly section: string;
  /** Which instance of a section that repeats within a dump, from 0. */
  readonly occurrence: number;
  readonly turn: number;
  /** The section's checksum for the turn. */
  readonly checksum: string;
  readonly records: readonly DesyncRecord[];
}

/** One desync's dump: every section's blocks for the last three turns. */
export interface DesyncDump {
  /** The newest turn in the dump: the desync turn. */
  readonly turn: number;
  readonly blocks: readonly DesyncBlock[];
}

/** `0x69707365` → `ipse`; a number that isn't four letters, digits or spaces stays decimal. */
export function fourCC(id: number): string {
  const bytes = [24, 16, 8, 0].map((shift) => (id >>> shift) & 0xff);
  return id > 0xffffff && bytes.every((byte) => /[A-Za-z0-9_ ]/.test(String.fromCharCode(byte))) ? String.fromCharCode(...bytes) : String(id);
}

const HEADER = /^\[Desync - (\d+) - Turn\((\d+)\) = (-?\d+)\]\s*$/;
const RECORD = /^(\t+)#(-?\d+)#(?:: (0x[0-9A-Fa-f]+))?\s*$/;

/** Every dump in a Desync.log, oldest first; the file appends one per desync across a session's games. */
export function parseDesyncLog(text: string): DesyncDump[] | string {
  const dumps: { turn: number; blocks: DesyncBlock[] }[] = [];
  let block: { section: string; occurrence: number; turn: number; checksum: string; records: DesyncRecord[] } | undefined;
  let open: string[] = [];
  let lastSection: string | undefined;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "" || /^=+\s*$/.test(line)) continue;
    const header = HEADER.exec(line);
    if (header !== null) {
      const section = fourCC(Number(header[1]));
      const turn = Number(header[2]);
      // A dump starts with Tempest's section; its next appearance after another section starts the next dump.
      if (dumps.length === 0 || (section === "ipse" && lastSection !== "ipse")) dumps.push({ turn, blocks: [] });
      const dump = dumps[dumps.length - 1];
      if (dump === undefined) return `line ${index + 1}: no dump`;
      const occurrence = dump.blocks.filter((other) => other.section === section && other.turn === turn).length;
      block = { section, occurrence, turn, checksum: String(Number(header[3]) >>> 0), records: [] };
      dump.blocks.push(block);
      dump.turn = Math.max(dump.turn, turn);
      lastSection = section;
      open = [];
      continue;
    }
    const record = RECORD.exec(line);
    if (record === null || block === undefined) return `line ${index + 1}: unrecognized ${JSON.stringify(line.slice(0, 80))}`;
    const depth = (record[1] ?? "").length;
    const id = `#${fourCC(Number(record[2]))}`;
    const value = record[3];
    open = open.slice(0, depth - 1);
    const path = [...open, id].join("/");
    block.records.push({ path, value: value?.toUpperCase().replace(/^0X/, "0x") });
    // A group opens without a value; the same id at the same depth with a value closes it.
    if (value === undefined) open.push(id);
  }
  return dumps;
}

/** The *_Desync.log a path names: the file, a report folder holding one, or the newest report under an Errors folder or a Documents/Warcraft III folder. */
export function findDesyncLog(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  if (statSync(path).isFile()) return path;
  const own = readdirSync(path).filter((name) => name.endsWith("_Desync.log")).sort();
  if (own.length > 0) return join(path, own[own.length - 1] ?? "");
  const errors = existsSync(join(path, "Errors")) ? join(path, "Errors") : path;
  // Report folders are named by their UTC time, so name order is write order.
  for (const report of readdirSync(errors).sort().reverse()) {
    const folder = join(errors, report);
    if (!statSync(folder).isDirectory()) continue;
    const logs = readdirSync(folder).filter((name) => name.endsWith("_Desync.log")).sort();
    if (logs.length > 0) return join(folder, logs[logs.length - 1] ?? "");
  }
  return undefined;
}

export interface DumpPair {
  readonly a: DesyncDump;
  readonly b: DesyncDump;
  /** Indexes of the chosen dumps, from 0, and how many each log holds. */
  readonly indexA: number;
  readonly indexB: number;
}

/** The newest dumps of the same desync turn (or `turn`), or the newest of each when no turn matches. */
export function pairDumps(a: readonly DesyncDump[], b: readonly DesyncDump[], turn?: number): DumpPair | string {
  for (let indexA = a.length - 1; indexA >= 0; indexA--) {
    const dumpA = a[indexA];
    if (dumpA === undefined || (turn !== undefined && dumpA.turn !== turn)) continue;
    for (let indexB = b.length - 1; indexB >= 0; indexB--) {
      const dumpB = b[indexB];
      if (dumpB !== undefined && dumpB.turn === dumpA.turn) return { a: dumpA, b: dumpB, indexA, indexB };
    }
  }
  if (turn !== undefined) return `no dump of turn ${turn} in both logs`;
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1];
  if (lastA === undefined || lastB === undefined) return "a log holds no dump";
  return { a: lastA, b: lastB, indexA: a.length - 1, indexB: b.length - 1 };
}

export interface BlockDifference {
  readonly section: string;
  readonly occurrence: number;
  readonly turn: number;
  readonly a: DesyncBlock | undefined;
  readonly b: DesyncBlock | undefined;
  /** Records that differ, by position, as [path, value in A, value in B]. */
  readonly records: readonly (readonly [path: string, a: string, b: string])[];
}

const blockKey = ({ section, occurrence, turn }: Pick<DesyncBlock, "section" | "occurrence" | "turn">) => `${section} ${occurrence} ${turn}`;
const recordText = (record: DesyncRecord | undefined) => record === undefined ? "missing" : `${record.path}${record.value === undefined ? "" : ` ${record.value}`}`;

/** Every block whose checksum or records differ, ordered by turn and then dump order. */
export function compareDumps(a: DesyncDump, b: DesyncDump): BlockDifference[] {
  const byKey = new Map(b.blocks.map((block) => [blockKey(block), block]));
  const seen = new Set<string>();
  const differences: BlockDifference[] = [];
  for (const block of [...a.blocks, ...b.blocks.filter((other) => !a.blocks.some((mine) => blockKey(mine) === blockKey(other)))]) {
    const key = blockKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    const inA = a.blocks.find((other) => blockKey(other) === key);
    const inB = byKey.get(key);
    const records: [string, string, string][] = [];
    const length = Math.max(inA?.records.length ?? 0, inB?.records.length ?? 0);
    for (let index = 0; index < length; index++) {
      const ra = inA?.records[index];
      const rb = inB?.records[index];
      if (ra?.path === rb?.path && ra?.value === rb?.value) continue;
      if (ra !== undefined && rb !== undefined && ra.path === rb.path) records.push([ra.path, ra.value ?? "", rb.value ?? ""]);
      else records.push([ra?.path ?? rb?.path ?? "?", recordText(ra), recordText(rb)]);
    }
    if (inA !== undefined && inB !== undefined && inA.checksum === inB.checksum && records.length === 0) continue;
    differences.push({ section: block.section, occurrence: block.occurrence, turn: block.turn, a: inA, b: inB, records });
  }
  return differences.sort((x, y) => x.turn - y.turn);
}

/** Tempest's presence table as an `ipse` block records it. */
export interface IpseState {
  readonly turn: number;
  readonly checksum: string;
  /** Record #1: the presence table's free-list head, Desync.txt's "next presence tag". */
  readonly presenceTag: number | undefined;
  /** Record #2: the birth counter, Desync.txt's "next birth tag". */
  readonly birthTag: number | undefined;
  /** Every record, for the ones without a known meaning. */
  readonly records: readonly DesyncRecord[];
}

export function ipseStates(dump: DesyncDump): IpseState[] {
  const value = (block: DesyncBlock, path: string) => {
    const text = block.records.find((record) => record.path === path)?.value;
    return text === undefined ? undefined : Number.parseInt(text, 16) | 0;
  };
  return dump.blocks.filter(({ section }) => section === "ipse").map((block) => ({
    turn: block.turn,
    checksum: block.checksum,
    presenceTag: value(block, "#1"),
    birthTag: value(block, "#2"),
    records: block.records,
  })).sort((x, y) => x.turn - y.turn);
}

const pad = (text: string | number, width: number) => String(text).padEnd(width);

/** The comparison's report: chosen dumps, first differing turn and section, the differing records and the decoded ipse table. */
export function formatDesyncComparison(paths: readonly [string, string], pair: DumpPair, counts: readonly [number, number], limit = 12): string {
  const differences = compareDumps(pair.a, pair.b);
  const lines = [
    `A ${paths[0]}: dump ${pair.indexA + 1} of ${counts[0]}, desync turn ${pair.a.turn}`,
    `B ${paths[1]}: dump ${pair.indexB + 1} of ${counts[1]}, desync turn ${pair.b.turn}`,
  ];
  if (pair.a.turn !== pair.b.turn) lines.push(`the logs hold no dump of the same turn; comparing each one's newest`);
  const first = differences[0];
  if (first === undefined) {
    lines.push("every section matches on every dumped turn");
  } else {
    const atFirst = differences.filter(({ turn }) => turn === first.turn);
    const sections = [...new Set(atFirst.map(({ section }) => section))];
    const allSections = [...new Set(differences.map(({ section }) => section))];
    lines.push(`first difference: turn ${first.turn}, section${sections.length > 1 ? "s" : ""} ${sections.join(", ")}`);
    lines.push(`sections that differ on any dumped turn: ${allSections.join(", ")}`);
    for (const difference of differences) {
      const name = `${difference.section}${difference.occurrence > 0 ? ` (${difference.occurrence + 1})` : ""}`;
      lines.push(`  turn ${difference.turn} ${name}: checksum A ${difference.a?.checksum ?? "missing"} B ${difference.b?.checksum ?? "missing"}`);
      for (const [path, a, b] of difference.records.slice(0, limit)) lines.push(`    ${path}: A ${a} B ${b}`);
      if (difference.records.length > limit) lines.push(`    ... ${difference.records.length - limit} more records differ`);
    }
  }
  const ipseA = ipseStates(pair.a);
  const ipseB = ipseStates(pair.b);
  if (ipseA.length > 0 || ipseB.length > 0) {
    lines.push("ipse (Tempest presence table): free head = next presence tag, births = next birth tag");
    lines.push(`  ${pad("turn", 6)}${pad("client", 8)}${pad("free head", 11)}${pad("births", 8)}records`);
    const turns = [...new Set([...ipseA, ...ipseB].map(({ turn }) => turn))].sort((x, y) => x - y);
    for (const turn of turns) {
      for (const [client, states] of [["A", ipseA], ["B", ipseB]] as const) {
        const state = states.find((candidate) => candidate.turn === turn);
        if (state === undefined) continue;
        const others = state.records.filter(({ path }) => path !== "#1" && path !== "#2").map(({ path, value }) => `${path} ${value ?? "{"}`).join(" ");
        lines.push(`  ${pad(turn, 6)}${pad(client, 8)}${pad(state.presenceTag ?? "-", 11)}${pad(state.birthTag ?? "-", 8)}${others}`);
      }
    }
    const lastA = ipseA[ipseA.length - 1];
    const lastB = ipseB.find(({ turn }) => turn === lastA?.turn);
    if (lastA?.birthTag !== undefined && lastB?.birthTag !== undefined && lastA.presenceTag !== undefined && lastB.presenceTag !== undefined) {
      const births = lastB.birthTag - lastA.birthTag;
      const head = lastB.presenceTag - lastA.presenceTag;
      if (births !== 0 || head !== 0) {
        lines.push(`  turn ${lastA.turn}: births B-A ${births >= 0 ? "+" : ""}${births}, free head B-A ${head >= 0 ? "+" : ""}${head}`);
      }
    }
    if (first !== undefined && differences.every(({ section }) => section === "ipse")) {
      lines.push("only Tempest's presence table differs: one client made or freed an agent (a handle, a code callback) on a different turn.");
      lines.push("Name it with `wisp engine poll` on both clients and `wisp engine diff` (wisp:docs/engine.md).");
    }
  }
  return lines.join("\n");
}

/** Reads, pairs and reports two clients' Desync.logs. */
export function compareDesyncLogs(pathA: string, pathB: string, turn?: number): string {
  const read = (path: string) => {
    const dumps = parseDesyncLog(readFileSync(path, "latin1"));
    if (typeof dumps === "string") throw new Error(`${path}: ${dumps}`);
    return dumps;
  };
  const a = read(pathA);
  const b = read(pathB);
  const pair = pairDumps(a, b, turn);
  if (typeof pair === "string") throw new Error(pair);
  return formatDesyncComparison([pathA, pathB], pair, [a.length, b.length]);
}
