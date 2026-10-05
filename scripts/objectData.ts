// Object data (format 2): war3map.w3u, war3map.w3a and the other custom-object
// files, plus the FileIO ability that hot reload and runtime file reads need.
import { CHUNKS_PER_FILE, FILE_IO_ABILITY } from "../src/runtime/gameFiles";

export type ObjectValue =
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "real"; readonly value: number }
  | { readonly kind: "string"; readonly value: string };

export interface Modification {
  /** Four-character field ID, such as `unam` or `atp1`. */
  readonly field: string;
  readonly value: ObjectValue;
  /** Ability, buff and upgrade data is per level; unit, item and doodad data has none. */
  readonly level?: number;
}

export interface ObjectDefinition {
  /** Four-character ID of the stock object it copies. */
  readonly base: string;
  /** The new object's ID as the integer map code uses, for example 0x2477736c for '$wsl'. */
  readonly id: number;
  readonly modifications: readonly Modification[];
}

const VALUE_TYPES = { int: 0, real: 1, string: 3 } as const;

/** One object-data file; `levels` selects the per-level layout of war3map.w3a, .w3q and .w3b. */
export function encodeObjectData(definitions: readonly ObjectDefinition[], levels: boolean): Uint8Array {
  const bytes: number[] = [];
  const scratch = new DataView(new ArrayBuffer(4));
  const int32 = (value: number) => {
    scratch.setInt32(0, value, true);
    bytes.push(...new Uint8Array(scratch.buffer));
  };
  const text = (value: string) => bytes.push(...new TextEncoder().encode(value));
  const id = (value: string) => {
    if (!/^[\x20-\x7e]{4}$/.test(value)) throw new Error(`object-data ID must be four printable characters: ${value}`);
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
    for (const { field, value, level = 0 } of definition.modifications) {
      id(field);
      int32(VALUE_TYPES[value.kind]);
      if (levels) {
        int32(level);
        int32(0); // Data column.
      }
      if (value.kind === "int") int32(value.value);
      else if (value.kind === "real") {
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
