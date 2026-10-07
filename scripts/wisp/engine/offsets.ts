// Where Tempest's presence table and the functions around it live, per game
// build. Every Warcraft III update moves them: wisp:scripts/wisp/engine/offsets.json
// holds one entry per file version, and `wisp engine locate` re-derives an
// entry from a running client (wisp:docs/engine.md#a-new-warcraft-build).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

const Hex = Schema.String.check(Schema.isPattern(/^0x[0-9a-f]+$/));

const Entry = Schema.Struct({
  sizeOfImage: Hex,
  /** RVA of the pointer to the presence table. */
  presenceTable: Hex,
  /** Offsets in the table: 16-byte entries (next free index or -2, then the agent), their count, the free-list head and the birth counter. */
  table: Schema.Struct({ entries: Hex, count: Hex, freeHead: Hex, births: Hex }),
  /** Offsets in an agent: its presence tag, its birth and the pointer to the handle object that owns it. */
  agent: Schema.Struct({ tag: Hex, birth: Hex, owner: Hex }),
  /** Function start RVA to what it does, for naming stack frames. */
  roles: Schema.Record(Hex, Schema.String),
});

const OffsetsFile = Schema.Record(Schema.String, Entry);

export interface EngineOffsets {
  readonly version: string;
  readonly sizeOfImage: number;
  readonly presenceTable: number;
  readonly table: { readonly entries: number; readonly count: number; readonly freeHead: number; readonly births: number };
  readonly agent: { readonly tag: number; readonly birth: number; readonly owner: number };
  readonly roles: ReadonlyMap<number, string>;
}

export const OFFSETS_FILE = join(import.meta.dir, "offsets.json");

const hex = (text: string) => Number.parseInt(text, 16);

/** Every build's offsets from `text`, an offsets.json. */
export function parseOffsets(text: string): Map<string, EngineOffsets> {
  const file = Schema.decodeUnknownSync(OffsetsFile)(JSON.parse(text));
  return new Map(Object.entries(file).map(([version, entry]) => [version, {
    version,
    sizeOfImage: hex(entry.sizeOfImage),
    presenceTable: hex(entry.presenceTable),
    table: { entries: hex(entry.table.entries), count: hex(entry.table.count), freeHead: hex(entry.table.freeHead), births: hex(entry.table.births) },
    agent: { tag: hex(entry.agent.tag), birth: hex(entry.agent.birth), owner: hex(entry.agent.owner) },
    roles: new Map(Object.entries(entry.roles).map(([rva, role]) => [hex(rva), role])),
  }]));
}

/** The offsets for a file version, or a message saying how to derive them. */
export function offsetsFor(version: string, file = OFFSETS_FILE): EngineOffsets | string {
  const all = parseOffsets(readFileSync(file, "utf8"));
  return all.get(version) ?? `no engine offsets for Warcraft III ${version} (known: ${[...all.keys()].join(", ")}); run \`wisp engine locate --client NAME\` and add its entry to ${file} (wisp:docs/engine.md#a-new-warcraft-build)`;
}

/** The entry `locate` prints, in the file's shape. */
export function offsetsEntry(offsets: EngineOffsets): Record<string, unknown> {
  const h = (value: number) => `0x${value.toString(16)}`;
  return {
    [offsets.version]: {
      sizeOfImage: h(offsets.sizeOfImage),
      presenceTable: h(offsets.presenceTable),
      table: { entries: h(offsets.table.entries), count: h(offsets.table.count), freeHead: h(offsets.table.freeHead), births: h(offsets.table.births) },
      agent: { tag: h(offsets.agent.tag), birth: h(offsets.agent.birth), owner: h(offsets.agent.owner) },
      roles: Object.fromEntries([...offsets.roles].map(([rva, role]) => [h(rva), role])),
    },
  };
}
