// Object data (format 2): war3map.w3u, war3map.w3a and the other custom-object
// files, plus the FileIO ability that hot reload and runtime file reads need.
import { CHUNKS_PER_FILE, FILE_IO_ABILITY } from "../src/runtime/gameFiles";

export type ObjectValue =
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "real"; readonly value: number }
  | { readonly kind: "unreal"; readonly value: number }
  | { readonly kind: "string"; readonly value: string };

export interface Modification {
  /** Four-character field ID, such as `unam` or `atp1`. */
  readonly field: string;
  readonly value: ObjectValue;
  /** Ability, buff and upgrade data is per level; unit, item and doodad data has none. */
  readonly level?: number;
  /** One-based ability Data A/B/... column; zero for ordinary fields. */
  readonly dataColumn?: number;
}

export interface ObjectDefinition {
  /** Four-character ID of the stock object it copies. */
  readonly base: string;
  /** The new object's ID as the integer map code uses, for example 0x2477736c for '$wsl'. */
  readonly id: number;
  readonly modifications: readonly Modification[];
}

const VALUE_TYPES = { int: 0, real: 1, unreal: 2, string: 3 } as const;

function rawcode(value: string): void {
  if (!/^[\x20-\x7e]{4}$/.test(value)) throw new Error(`object-data ID must be four printable characters: ${value}`);
}

function idText(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`invalid object-data ID: ${value}`);
  const text = String.fromCharCode(value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255);
  rawcode(text);
  return text;
}

function integer(value: number, label: string, minimum = -0x80000000): void {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff) throw new Error(`invalid ${label}: ${value}`);
}

/** One object-data file; `levels` selects the per-level layout of war3map.w3a, .w3q and .w3b. */
export function encodeObjectData(definitions: readonly ObjectDefinition[], levels: boolean): Uint8Array {
  const ids = new Set<number>();
  for (const definition of definitions) {
    rawcode(definition.base);
    idText(definition.id);
    if (ids.has(definition.id)) throw new Error(`duplicate new object ID: ${idText(definition.id)}`);
    ids.add(definition.id);
    for (const { field, value, level = 0, dataColumn = 0 } of definition.modifications) {
      rawcode(field);
      integer(level, "object level", 0);
      integer(dataColumn, "data column", 0);
      if (!levels && (level !== 0 || dataColumn !== 0)) throw new Error(`unit/item field ${field} cannot have a level or data column`);
      if (value.kind === "string") {
        if (value.value.includes("\0")) throw new Error(`object field ${field} contains a null character`);
      } else if (value.kind === "int") integer(value.value, `integer field ${field}`);
      else if (!Number.isFinite(value.value)) throw new Error(`non-finite object field ${field}`);
    }
  }
  const bytes: number[] = [];
  const scratch = new DataView(new ArrayBuffer(4));
  const int32 = (value: number) => {
    scratch.setInt32(0, value, true);
    bytes.push(...new Uint8Array(scratch.buffer));
  };
  const text = (value: string) => bytes.push(...new TextEncoder().encode(value));
  const id = (value: string) => {
    text(value);
  };
  int32(2);
  int32(0); // No changed stock objects.
  int32(definitions.length);
  for (const definition of definitions) {
    id(definition.base);
    scratch.setUint32(0, definition.id, false);
    bytes.push(...new Uint8Array(scratch.buffer));
    int32(definition.modifications.length);
    for (const { field, value, level = 0, dataColumn = 0 } of definition.modifications) {
      id(field);
      int32(VALUE_TYPES[value.kind]);
      if (levels) {
        int32(level);
        int32(dataColumn);
      }
      if (value.kind === "int") int32(value.value);
      else if (value.kind === "real" || value.kind === "unreal") {
        scratch.setFloat32(0, value.value, true);
        bytes.push(...new Uint8Array(scratch.buffer));
      } else {
        text(value.value);
        bytes.push(0);
      }
      bytes.push(0, 0, 0, 0);
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * FileIO's channel ability ('$wsl'): the map reads host-written files through
 * its tooltips, one per level. Hot reload needs it in every map.
 */
export const FILE_IO_OBJECT: ObjectDefinition = {
  base: "ANcl",
  id: FILE_IO_ABILITY,
  modifications: [
    { field: "alev", value: { kind: "int", value: CHUNKS_PER_FILE } },
    ...Array.from({ length: CHUNKS_PER_FILE }, (_, index): Modification => ({ field: "atp1", value: { kind: "string", value: " " }, level: index + 1 })),
  ],
};

/** war3map.w3a holding the FileIO ability and the map's own abilities. */
export function abilityData(definitions: readonly ObjectDefinition[] = []): Uint8Array {
  return encodeObjectData([FILE_IO_OBJECT, ...definitions], true);
}

class ObjectBuilder {
  private readonly modifications = new Map<string, Modification>();
  constructor(readonly id: number, readonly base: string) {
    idText(id);
    rawcode(base);
  }
  protected set(field: string, value: ObjectValue, level = 0, dataColumn = 0): this {
    this.modifications.set(`${field}:${level}:${dataColumn}`, { field, value, level, dataColumn });
    return this;
  }
  build(): ObjectDefinition {
    return { base: this.base, id: this.id, modifications: [...this.modifications.values()] };
  }
}

/** Typed unit fields; the same numeric id is imported by map code. */
export class UnitObject extends ObjectBuilder {
  name(value: string): this { return this.set("unam", { kind: "string", value }); }
  tooltip(value: string): this { return this.set("utip", { kind: "string", value }); }
  extendedTooltip(value: string): this { return this.set("utub", { kind: "string", value }); }
  model(value: string): this { return this.set("umdl", { kind: "string", value }); }
  scale(value: number): this { return this.set("usca", { kind: "real", value }); }
  hitPoints(value: number): this { return this.set("uhpm", { kind: "int", value }); }
  movementSpeed(value: number): this { return this.set("umvs", { kind: "int", value }); }
  abilities(value: readonly number[]): this { return this.set("uabi", { kind: "string", value: value.map(idText).join(",") }); }
}

export type AbilityTarget = "air" | "ground" | "enemy" | "friend" | "self" | "neutral" | "organic" | "mechanical" | "structure" | "hero" | "nonhero" | "vulnerable" | "invulnerable";

/** General ability fields plus Blizzard's damage and wave data columns. */
export class AbilityObject extends ObjectBuilder {
  private count = 1;
  name(value: string): this { return this.set("anam", { kind: "string", value }); }
  hero(value: boolean): this { return this.set("aher", { kind: "int", value: value ? 1 : 0 }); }
  levels(value: number): this {
    integer(value, "ability level count", 1);
    this.count = value;
    return this.set("alev", { kind: "int", value });
  }
  private atLevel(level: number): void {
    integer(level, "ability level", 1);
    if (level > this.count) throw new Error(`ability level ${level} exceeds ${this.count} declared levels`);
  }
  tooltip(level: number, value: string): this { this.atLevel(level); return this.set("atp1", { kind: "string", value }, level); }
  extendedTooltip(level: number, value: string): this { this.atLevel(level); return this.set("aub1", { kind: "string", value }, level); }
  manaCost(level: number, value: number): this { this.atLevel(level); return this.set("amcs", { kind: "int", value }, level); }
  cooldown(level: number, value: number): this { this.atLevel(level); return this.set("acdn", { kind: "unreal", value }, level); }
  targets(level: number, value: readonly AbilityTarget[]): this { this.atLevel(level); return this.set("atar", { kind: "string", value: value.join(",") }, level); }
  blizzardDamage(level: number, value: number): this {
    this.atLevel(level);
    if (this.base !== "AHbz") throw new Error("Blizzard damage requires the AHbz base ability");
    return this.set("Hbz2", { kind: "unreal", value }, level, 2);
  }
  blizzardWaves(level: number, value: number): this {
    this.atLevel(level);
    if (this.base !== "AHbz") throw new Error("Blizzard waves require the AHbz base ability");
    return this.set("Hbz1", { kind: "int", value }, level, 1);
  }
  override build(): ObjectDefinition {
    const result = super.build();
    for (const modification of result.modifications) if ((modification.level ?? 0) > this.count) throw new Error("ability field exceeds declared levels");
    return result;
  }
}
